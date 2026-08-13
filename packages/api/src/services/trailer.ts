// packages/api/src/services/trailer.ts
// Trailer domain (03 §2.6, 04 §4, C1.11/C1.12). `swap` is the hook/drop operation (spec 1.3): it
// closes the vehicle's active assignment (drop to bobtail, or swap-off) using the drop photo, then
// hooks the new trailer — either an existing one or a driver-created external trailer (C1.11,
// is_external=true) — recording the licence-plate photo and the 3-item TRAILER_SWAP inspection.
// The unique partial indexes prevent a double-hook (DB authority); the service pre-checks for the
// frozen `DUPLICATE` code. Every rule returns a Result with a frozen `error_code` (08 §1).

import {
  conflict,
  err,
  NotFound,
  ok,
  type Result,
  type Tx,
  ValidationError,
} from "@fleet/shared";
import type { TrailerSwapInput } from "@fleet/shared";
import type { TrailerAssignmentRow, TrailerRow } from "@fleet/shared";
import { TrailerAssignmentRepository } from "../repositories/trailer";
import type { TrailerRepository } from "../repositories/shifts";
import type { InspectionRepository } from "../repositories/inspections";
import type { Actor } from "./shift";

export interface TrailerSwapOutcome {
  trailerAssignmentId: string | null;
  droppedTrailerId: string | null;
  createdTrailerId: string | null;
}

/** A single ACTIVE trailer↔vehicle hook, shaped for the admin list endpoint. */
export interface TrailerAssignmentListItem {
  trailer_id: string;
  vehicle_id: string;
  vehicle_plate: string | null;
  hooked_at: string | null;
}

export class TrailerService {
  constructor(
    private readonly assignments: TrailerAssignmentRepository,
    private readonly trailers: TrailerRepository,
    private readonly inspections: InspectionRepository,
  ) {}

  async swap(
    tx: Tx,
    driverId: string,
    input: TrailerSwapInput,
    actor: Actor,
  ): Promise<Result<TrailerSwapOutcome>> {
    // The hook inspection must be the abbreviated 3-item TRAILER_SWAP check (spec 1.3 step 3).
    const inspection = await this.inspections.getById(input.hook_inspection_id);
    if (!inspection) return err(new NotFound("Hook inspection not found"));
    if (inspection.subject !== "TRAILER_SWAP") {
      return err(new ValidationError("Invalid hook inspection", [
        { field: "hook_inspection_id", code: "INVALID", message: "The hook inspection must be a TRAILER_SWAP check." },
      ]));
    }

    // Resolve the target trailer: an existing one, or a driver-created external trailer (C1.11).
    let targetTrailerId: string | null = null;
    let createdTrailerId: string | null = null;
    if (input.new_trailer_plate) {
      if (input.trailer_id) {
        return err(new ValidationError("Ambiguous trailer", [
          { field: "trailer_id", code: "CONFLICT", message: "Provide either trailer_id or new_trailer_plate, not both." },
        ]));
      }
      if (!input.new_trailer_type) {
        return err(new ValidationError("Missing trailer type", [
          { field: "new_trailer_type", code: "REQUIRED", message: "A driver-created trailer requires new_trailer_type." },
        ]));
      }
      const created = await this.trailers.insert({
        license_plate: input.new_trailer_plate,
        trailer_type: input.new_trailer_type,
        status: "EXTERNAL",
        is_external: true,
        current_vehicle_id: input.vehicle_id,
        created_by_driver_id: driverId,
      } as Partial<TrailerRow>);
      targetTrailerId = created.id;
      createdTrailerId = created.id;
    } else if (input.trailer_id) {
      const trailer = await this.trailers.getById(input.trailer_id);
      if (!trailer) return err(new NotFound("Trailer not found"));
      targetTrailerId = input.trailer_id;
    }

    // Close any active assignment on this vehicle (drop to bobtail, or swap-off).
    const active = await this.assignments.findActiveByVehicle(input.vehicle_id);
    let droppedTrailerId: string | null = null;
    if (active) {
      if (!input.drop_media_object_id) {
        return err(new ValidationError("Drop photo required", [
          { field: "drop_media_object_id", code: "REQUIRED", message: "Dropping the current trailer requires drop_media_object_id." },
        ]));
      }
      droppedTrailerId = active.trailer_id;
      await this.assignments.update(active.id, {
        unassigned_at: new Date().toISOString(),
        unassigned_by_driver_id: driverId,
        drop_media_object_id: input.drop_media_object_id,
      } as Partial<TrailerAssignmentRow>);
      // Clear the dropped trailer's current-vehicle pointer (B15).
      await this.trailers.update(active.trailer_id, { current_vehicle_id: null } as Partial<TrailerRow>);
    }

    // Hook the new trailer (if any). The unique partial index blocks a double-hook; pre-check for a clean code.
    let assignmentId: string | null = null;
    if (targetTrailerId) {
      const trailerActive = await this.assignments.findActiveByTrailer(targetTrailerId);
      if (trailerActive && trailerActive.vehicle_id !== input.vehicle_id) {
        return err(conflict("DUPLICATE", "Trailer already assigned", `Trailer ${targetTrailerId} is already hooked to another vehicle.`));
      }
      const assignment = await this.assignments.insert({
        trailer_id: targetTrailerId,
        vehicle_id: input.vehicle_id,
        shift_id: input.shift_id ?? null,
        assigned_by_driver_id: driverId,
        hook_media_object_id: input.hook_media_object_id,
        hook_inspection_id: input.hook_inspection_id,
      } as Partial<TrailerAssignmentRow>);
      assignmentId = assignment.id;
      await this.trailers.update(targetTrailerId, { current_vehicle_id: input.vehicle_id } as Partial<TrailerRow>);
    }

    tx.audit({
      action: "UPDATE",
      entity_table: "app.trailer_assignments",
      entity_id: assignmentId ?? droppedTrailerId ?? "",
      actor_user_id: actor.userId,
      actor_email: actor.email,
      actor_role_codes: actor.roles,
      request_id: (tx as { requestId?: string }).requestId,
      endpoint: "/trailer/swap",
      http_method: "POST",
    });
    tx.registerOutbox({
      event_type: "trailer.swap",
      aggregate_type: "trailer_assignment",
      aggregate_id: assignmentId ?? droppedTrailerId ?? "",
      payload: { vehicleId: input.vehicle_id, trailerId: targetTrailerId, droppedTrailerId },
    });

    return ok({ trailerAssignmentId: assignmentId, droppedTrailerId, createdTrailerId });
  }

  /**
   * Tenant-scoped list of ACTIVE trailer↔vehicle hooks (the hook/drop ledger, app.trailer_assignments).
   * "Active" = not yet dropped (unassigned_at IS NULL) and carrying a trailer. The vehicle plate is
   * joined in (mirrors the onboarding dispatch query). Tenant isolation is enforced by RLS on the
   * read client; trailer_id/trailer assignments carry no denormalised tenant column.
   */
  async listActiveAssignments(tenantId: string): Promise<Result<TrailerAssignmentListItem[]>> {
    const res = await this.assignments.dbClient.query<TrailerAssignmentListItem & Record<string, unknown>>(
      `SELECT ta.trailer_id                                   AS trailer_id,
              ta.vehicle_id                                   AS vehicle_id,
              v.license_plate                                 AS vehicle_plate,
              ta.assigned_at::text                            AS hooked_at
         FROM app.trailer_assignments ta
         LEFT JOIN app.vehicles v ON v.id = ta.vehicle_id
        WHERE ta.unassigned_at IS NULL
          AND ta.trailer_id IS NOT NULL
        ORDER BY ta.assigned_at DESC`,
      [],
    );
    return ok(
      res.rows.map((r) => ({
        trailer_id: r.trailer_id,
        vehicle_id: r.vehicle_id,
        vehicle_plate: r.vehicle_plate,
        hooked_at: r.hooked_at,
      })),
    );
  }
}
