// packages/api/src/services/asset.ts
// Vehicle master-data service (Pillar 4). Pure business rules over the VehicleRepository; returns
// Result<T> and never throws for domain rules (08 §1). Reads use a pooled client; create/update run
// inside the request transaction (D8). Keyset pagination on (license_plate, id).

import { type DbClient, type Result, ok, err, NotFound, type VehicleRow } from "@fleet/shared";
import { MAX_PAGE_LIMIT, decodeCursor, buildPage } from "../http/pagination";
import { VehicleRepository } from "../repositories/shifts";

export interface VehicleListRow extends VehicleRow {}

export class VehicleService {
  constructor(private readonly vehicles: VehicleRepository) {}

  async list(opts: { limit: number; cursor?: string | null }): Promise<Result<{ data: VehicleListRow[]; next_cursor: string | null; has_more: boolean }>> {
    const limit = Math.min(Math.max(opts.limit, 1), MAX_PAGE_LIMIT);
    const params: unknown[] = [];
    const where = ["deleted_at IS NULL"];
    const cursor = decodeCursor(opts.cursor ?? undefined);
    if (cursor) {
      params.push(cursor.sort, cursor.id);
      where.push(`(license_plate, id) > ($${params.length - 1}::text, $${params.length})`);
    }
    const res = await this.vehicles.dbClient.query<VehicleListRow>(
      `SELECT * FROM app.vehicles WHERE ${where.join(" AND ")}
       ORDER BY license_plate ASC, id ASC
       LIMIT $${params.length + 1}`,
      [...params, limit + 1],
    );
    const page = buildPage(res.rows, limit, (row) => ({ sort: String(row.license_plate ?? ""), id: row.id }));
    return ok(page);
  }

  async getOne(id: string): Promise<Result<VehicleListRow>> {
    const row = await this.vehicles.getById(id);
    if (!row || row.deleted_at) return err(new NotFound("Vehicle not found"));
    return ok(row);
  }

  async create(input: {
    license_plate: string;
    vehicle_class: string;
    make?: string;
    model?: string;
    year?: number;
    ownership_type?: string;
    fuel_tank_capacity_litres?: number;
  }, actorId: string): Promise<Result<VehicleListRow>> {
    void actorId;
    const row = await this.vehicles.insert({
      license_plate: input.license_plate,
      vehicle_class: input.vehicle_class as VehicleRow["vehicle_class"],
      make: input.make ?? null,
      model: input.model ?? null,
      year: input.year ?? null,
      ownership_type: (input.ownership_type as VehicleRow["ownership_type"]) ?? "OWNED",
      fuel_tank_capacity_litres: input.fuel_tank_capacity_litres != null ? String(input.fuel_tank_capacity_litres) : "0",
      status: "AVAILABLE",
      is_operational: true,
    } as unknown as Record<string, unknown>);
    return ok(row);
  }

  async update(id: string, input: Partial<{
    license_plate: string;
    make: string;
    model: string;
    year: number;
    status: string;
    is_operational: boolean;
    notes: string;
  }>, actorId: string): Promise<Result<VehicleListRow>> {
    void actorId;
    const existing = await this.vehicles.getById(id);
    if (!existing || existing.deleted_at) return err(new NotFound("Vehicle not found"));
    const row = await this.vehicles.update(id, input as Partial<VehicleRow>);
    return ok(row as VehicleListRow);
  }
}
