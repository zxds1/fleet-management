// packages/api/src/services/inspections.ts
// Inspection (DVIR) domain (03 §2.5, 08 §3/§5). `submit` inserts the inspection plus its items and
// photos in one transaction (D8), enforcing the DB contracts for a clean error_code: `DEFECTS_NOT_REVIEWED`
// (previous defects must be acknowledged, C1.6), `DVIR_FAIL_NEEDS_PHOTO` (a FAIL item requires a
// photo, deferred trigger), and the FAIL-requires-notes check. A BLOCKER failure quarantines the asset
// and marks it non-operational (C1.5). Every rule returns a Result with a frozen `error_code` (08 §1).

import {
  err,
  NotFound,
  ok,
  type Result,
  type Tx,
  ValidationError,
  violation,
} from "@fleet/shared";
import type { InspectionSubmitInput } from "@fleet/shared";
import type { InspectionItemInput } from "@fleet/shared";
import type {
  InspectionItemRow,
  InspectionRow,
  InspectionTemplateItemRow,
  InspectionTemplateRow,
  TrailerRow,
  VehicleRow,
} from "@fleet/shared";
import {
  InspectionItemPhotoRepository,
  InspectionItemRepository,
  InspectionRepository,
  InspectionTemplateItemRepository,
  InspectionTemplateRepository,
  QuarantineRepository,
} from "../repositories/inspections";
import type { TrailerRepository, VehicleRepository } from "../repositories/shifts";
import type { Actor } from "./shift";

export interface InspectionOutcome {
  inspectionId: string;
  blockShift: boolean;
}

export class InspectionService {
  constructor(
    private readonly inspections: InspectionRepository,
    private readonly items: InspectionItemRepository,
    private readonly photos: InspectionItemPhotoRepository,
    private readonly templates: InspectionTemplateRepository,
    private readonly templateItems: InspectionTemplateItemRepository,
    private readonly vehicles: VehicleRepository,
    private readonly trailers: TrailerRepository,
    private readonly quarantine: QuarantineRepository,
  ) {}

  async submit(
    tx: Tx,
    driverId: string,
    input: InspectionSubmitInput,
    actor: Actor,
  ): Promise<Result<InspectionOutcome>> {
    const template = await this.templates.getById(input.template_id);
    if (!template) return err(new NotFound("Inspection template not found"));
    if (template.subject !== input.subject) {
      return err(new ValidationError("Template/subject mismatch", [
        { field: "subject", code: "MISMATCH", message: `Template is for ${template.subject}, not ${input.subject}.` },
      ]));
    }

    // Target consistency (inspections_subject_target CHECK).
    if (input.subject === "VEHICLE") {
      if (!input.vehicle_id) {
        return err(new ValidationError("Missing vehicle for a VEHICLE inspection", [
          { field: "vehicle_id", code: "REQUIRED", message: "A VEHICLE inspection requires vehicle_id." },
        ]));
      }
    } else if (!input.trailer_id) {
      return err(new ValidationError("Missing trailer for a TRAILER inspection", [
        { field: "trailer_id", code: "REQUIRED", message: "A TRAILER/TRAILER_SWAP inspection requires trailer_id." },
      ]));
    }

    // C1.6: the driver must affirmatively acknowledge previous defects.
    if (!input.previous_defects_reviewed) {
      return err(violation("DEFECTS_NOT_REVIEWED", "Previous defects not reviewed", "previous_defects_reviewed must be true (C1.6)."));
    }

    // Resolve each item's template snapshot + severity, and pre-check the FAIL requirements.
    const snapshots: { item: InspectionItemInput; tmpl: InspectionTemplateItemRow }[] = [];
    let hasBlocking = false;
    let hasWarning = false;
    for (const [i, item] of input.items.entries()) {
      const tmpl = await this.templateItems.getById(item.template_item_id);
      if (!tmpl) {
        return err(new ValidationError("Unknown template item", [
          { field: `items[${i}].template_item_id`, code: "UNKNOWN", message: "Template item not found." },
        ]));
      }
      if (item.result === "FAIL") {
        if (!item.notes || item.notes.trim() === "") {
          return err(new ValidationError("Failing item requires a note", [
            { field: `items[${i}].notes`, code: "REQUIRED", message: "A FAIL result must include a note." },
          ]));
        }
        if (!item.photo_media_object_id) {
          return err(violation("DVIR_FAIL_NEEDS_PHOTO", "Failing item requires a photo", "A FAIL result requires at least one photo (1.1/1.2)."));
        }
        if (tmpl.severity === "BLOCKER") hasBlocking = true;
        else hasWarning = true;
      }
      snapshots.push({ item, tmpl });
    }

    const inspection = await this.inspections.insert({
      shift_id: input.shift_id,
      template_id: input.template_id,
      template_version: template.version,
      subject: input.subject,
      vehicle_id: input.vehicle_id ?? null,
      trailer_id: input.trailer_id ?? null,
      performed_by_driver_id: driverId,
      performed_at: new Date().toISOString(),
      has_blocking_failure: hasBlocking,
      has_warning_failure: hasWarning,
      previous_defects_reviewed: true,
      signature_name: input.signature_name,
      signed_at: new Date().toISOString(),
    } as Partial<InspectionRow>);

    for (const { item, tmpl } of snapshots) {
      const inserted = await this.items.insert({
        inspection_id: inspection.id,
        template_item_id: item.template_item_id,
        item_code: tmpl.code,
        label_snapshot: tmpl.label_en,
        severity_snapshot: tmpl.severity,
        result: item.result,
        numeric_value: item.numeric_value != null ? String(item.numeric_value) : null,
        notes: item.notes ?? null,
      } as Partial<InspectionItemRow>);

      if (item.photo_media_object_id) {
        await this.photos.insert({
          inspection_item_id: inserted.id,
          media_object_id: item.photo_media_object_id,
        });
      }
    }

    // C1.5: a BLOCKER failure quarantines the asset and marks it non-operational.
    if (hasBlocking) {
      const vehicleId = input.subject === "VEHICLE" ? input.vehicle_id! : null;
      const trailerId = input.subject !== "VEHICLE" ? input.trailer_id! : null;
      const reason = "FAILED_INSPECTION";
      if (vehicleId) {
        await this.vehicles.update(vehicleId, { is_operational: false, non_operational_reason: reason } as Partial<VehicleRow>);
      } else if (trailerId) {
        await this.trailers.update(trailerId, { is_operational: false, non_operational_reason: reason } as Partial<TrailerRow>);
      }
      const alreadyQuarantined = await this.quarantine.hasOpenForAsset(vehicleId, trailerId);
      if (!alreadyQuarantined) {
        await this.quarantine.insert({
          vehicle_id: vehicleId,
          trailer_id: trailerId,
          reason,
          reason_notes: "Failed DVIR (BLOCKER)",
          source_inspection_id: inspection.id,
          triggered_by_system: false,
          triggered_by_user_id: actor.userId,
          quarantined_at: new Date().toISOString(),
          requires_repair_document: false,
        } as Partial<QuarantineEventRowStub>);
      }
    }

    tx.audit({
      action: "CREATE",
      entity_table: "app.inspections",
      entity_id: inspection.id,
      actor_user_id: actor.userId,
      actor_email: actor.email,
      actor_role_codes: actor.roles,
      request_id: (tx as { requestId?: string }).requestId,
      endpoint: "/inspections",
      http_method: "POST",
    });
    tx.registerOutbox({
      event_type: "inspection.submitted",
      aggregate_type: "inspection",
      aggregate_id: inspection.id,
      payload: { hasBlockingFailure: hasBlocking, blockShift: hasBlocking },
    });

    return ok({ inspectionId: inspection.id, blockShift: hasBlocking });
  }
}

// Minimal structural type for the quarantine insert (the row type has many nullable columns).
type QuarantineEventRowStub = {
  vehicle_id: string | null;
  trailer_id: string | null;
  reason: string;
  reason_notes: string | null;
  source_inspection_id: string | null;
  triggered_by_system: boolean;
  triggered_by_user_id: string;
  quarantined_at: string;
  requires_repair_document: boolean;
};
