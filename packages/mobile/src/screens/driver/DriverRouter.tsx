// packages/mobile/src/screens/driver/DriverRouter.tsx
//
// Post-auth driver navigation. Holds the driver sub-screen state and wires the journey screens to the
// core services (`shifts`, `refuel`, `inspections`, `accidents`, `media`, `queue`). Each submission
// maps the screen payload → service call, surfaces domain errors, and reports offline-queued results.
// Evidence `CapturedPhoto` is shape-compatible with the core `EvidencePhoto`.

import React, { useCallback, useEffect, useState } from "react"
import { View, ActivityIndicator } from "react-native"
import { theme } from "@/design/theme"
import { Text } from "@/design/components/Text"
import { OfflineBanner } from "@/design/components/OfflineBanner"
import { TopAppBar } from "@/design/components/TopAppBar"
import { BottomNav } from "@/design/components/BottomNav"
import { DriverHomeScreen } from "./DriverHomeScreen"
import { ClockInScreen } from "./ClockInScreen"
import { ClockOutScreen } from "./ClockOutScreen"
import { RefuelScreen, type RefuelCorrections, type RefuelOcrPreview, type RefuelSubmitPayload } from "./RefuelScreen"
import { InspectionScreen } from "./InspectionScreen"
import { AccidentScreen } from "./AccidentScreen"
import { NotificationsScreen } from "./NotificationsScreen"
import { AnomaliesScreen } from "./AnomaliesScreen"
import { VehicleStateScreen } from "./VehicleStateScreen"
import { VehicleIssueScreen, type VehicleIssueSubmitPayload } from "./VehicleIssueScreen"
import { ProfileScreen } from "./ProfileScreen"
import { MyShiftsScreen } from "./MyShiftsScreen"
import { FuelHistoryScreen } from "./FuelHistoryScreen"
import { DvirListScreen } from "./DvirListScreen"
import { DvirDetailScreen } from "./DvirDetailScreen"
import { MyAccidentsScreen } from "./MyAccidentsScreen"
import { AccidentDetailScreen } from "./AccidentDetailScreen"
import { DocumentsScreen } from "./DocumentsScreen"
import { OutboxScreen } from "./OutboxScreen"
import { SuspendedScreen } from "./SuspendedScreen"
import { OfflinePinScreen } from "./OfflinePinScreen"
import { RoleSwitchScreen, type AppRole } from "./RoleSwitchScreen"
import { OnboardingProfileSetupScreen } from "./OnboardingProfileSetupScreen"
import { BackgroundCheckScreen } from "./BackgroundCheckScreen"
import { VehicleAssignmentScreen } from "./VehicleAssignmentScreen"
import { ReadyToDriveScreen } from "./ReadyToDriveScreen"
import { TrainingHubScreen } from "./TrainingHubScreen"
import { LessonDetailScreen } from "./LessonDetailScreen"
import { ResourceLibraryScreen } from "./ResourceLibraryScreen"
import { t, getLocale, setLocale, availableLocales, type Locale } from "@/core/i18n"
import type { Services } from "@/services"
import type { ActiveShift } from "@/core/driver/shifts"
import type { OnboardingState } from "@/core/driver/onboarding"
import type { AppError } from "@/core/error"
import { fromUnknown } from "@/core/error"
import type { FuelGaugeLevel, FuelCorrectionInput } from "@fleet/shared/mobile"
import type { CapturedPhoto } from "@/design/components/PhotoCapture"
import type { SubmitResult } from "@/core/driver/types"

type DriverScreen = "home" | "clockIn" | "clockOut" | "refuel" | "inspection" | "accident" | "vehicleIssue" | "notifications" | "anomalies" | "vehicle" | "profile" | "myShifts" | "fuelHistory" | "dvirList" | "dvirDetail" | "myAccidents" | "accidentDetail" | "documents" | "outbox" | "training" | "lessonDetail" | "resources" | "suspended" | "offlinePin" | "roleSwitch" | "onboardingProfile" | "onboardingBackground" | "onboardingVehicle" | "onboardingReady"

/** Onboarding steps in flow order; the index into this array is the router's step pointer. */
const ONBOARDING_STEPS = ["onboardingProfile", "onboardingBackground", "onboardingVehicle", "onboardingReady"] as const
type OnboardingStep = (typeof ONBOARDING_STEPS)[number]

function isOnboardingScreen(screen: DriverScreen): screen is OnboardingStep {
  return (ONBOARDING_STEPS as readonly string[]).includes(screen)
}

/**
 * Resolve the step a returning driver should land on from the persisted onboarding record (the
 * flow is resumable across devices — nothing is kept locally):
 *   • profile not captured yet                      → profile
 *   • profile present, check not submitted           → background
 *   • check submitted/cleared, no vehicle yet        → vehicle
 *   • cleared + vehicle assigned                     → ready
 */
export function resolveOnboardingStep(state: OnboardingState): OnboardingStep {
  const profileComplete = Boolean(state.full_name && state.licence_number)
  if (!profileComplete) return "onboardingProfile"
  const submitted = state.background_check_status === "SUBMITTED" || state.background_check_status === "CLEARED"
  if (!submitted) return "onboardingBackground"
  if (!state.assigned_vehicle_id) return "onboardingVehicle"
  if (state.background_check_status === "CLEARED") return "onboardingReady"
  return "onboardingVehicle"
}

const DEMO_TEMPLATE_ID = "00000000-0000-4000-8000-0000000000d1"

/**
 * Map the review-step edits onto the wire contract (`FuelCorrectionSchema`): amounts and litres are
 * numeric there, and `corrected_date` is a date-only string, so an ISO timestamp is trimmed to its
 * date part. Fields the driver did not touch, or typed unparseably, are dropped rather than sent as
 * NaN — a partial correction is valid, a malformed one is not.
 */
function toFuelCorrection(c: RefuelCorrections): Omit<FuelCorrectionInput, "purchase_id"> {
  const out: Omit<FuelCorrectionInput, "purchase_id"> = {}
  const amount = c.amount === undefined ? NaN : Number(c.amount)
  if (Number.isFinite(amount) && amount > 0) out.corrected_amount = amount
  if (c.liters !== undefined && Number.isFinite(c.liters) && c.liters > 0) out.corrected_liters = c.liters
  if (c.date) {
    const date = c.date.slice(0, 10)
    if (/^\d{4}-\d{2}-\d{2}$/.test(date)) out.corrected_date = date
  }
  if (c.station) out.corrected_station = c.station
  return out
}


/**
 * Clock-in needs the dispatch `assignment_id`, but no driver-scoped read exposes it today:
 * `GET /drivers/me/assignment` returns only `vehicle_id`/`vehicle_plate`, and `GET /shifts/me/active`
 * (which does carry it) is by definition empty before the shift exists. Until the gateway surfaces
 * it this placeholder stands in; it is the one value on this screen the driver cannot supply.
 */
const PLACEHOLDER_ASSIGNMENT_ID = "00000000-0000-4000-8000-0000000000b1"

const DEMO_TEMPLATE = [
  { template_item_id: "00000000-0000-4000-8000-0000000000a1", label: "Tyres & tread" },
  { template_item_id: "00000000-0000-4000-8000-0000000000a2", label: "Brakes & warning lights" },
  { template_item_id: "00000000-0000-4000-8000-0000000000a3", label: "Mirrors & wipers" },
]

export interface DriverRouterProps {
  services: Services
  onLogout: () => void
  /**
   * Mounts the other root navigator. `App.tsx` owns the `role` state that chooses between
   * `DriverRouter` and `AdminRouter`, so this callback is `setRole(role) + setStep("authed")` —
   * the driver surface is unmounted and the admin surface mounted in its place. Absent (e.g. in
   * tests that render the router standalone) the role-switch entry point is hidden.
   */
  onSwitchRole?: (role: AppRole) => void
}

export function DriverRouter({ services, onLogout, onSwitchRole }: DriverRouterProps) {
  const [screen, setScreen] = useState<DriverScreen>("home")
  const [active, setActive] = useState<ActiveShift | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<AppError | undefined>()
  const [outboxCount, setOutboxCount] = useState(0)
  const [toast, setToast] = useState<string>()
  const [notifications, setNotifications] = useState(services.feed.notifications)
  const [anomalies, setAnomalies] = useState(services.feed.anomalies)
  const [vehicle, setVehicle] = useState(services.feed.vehicle)
  const [online, setOnline] = useState(true)
  // Selected row ids for the list → detail journeys (B.7 / B.10 / B.12 / B.14 / B.15).
  const [dvirId, setDvirId] = useState<string>()
  const [accidentId, setAccidentId] = useState<string>()
  const [shiftId, setShiftId] = useState<string>()
  // Photo-first refuel: the flow position, the OCR preview polled after submission, and the id of
  // the purchase the review-step corrections are posted against.
  const [refuelPhase, setRefuelPhase] = useState<"capture" | "awaiting_ocr" | "review" | "done">("capture")
  const [refuelOcr, setRefuelOcr] = useState<RefuelOcrPreview | undefined>()
  const [refuelPurchaseId, setRefuelPurchaseId] = useState<string>()

  /** Clear every per-run refuel value so a re-entry starts from the receipt capture. */
  const resetRefuel = useCallback(() => {
    setRefuelPhase("capture")
    setRefuelOcr(undefined)
    setRefuelPurchaseId(undefined)
  }, [])

  /**
   * Odometer baseline the new reading must beat. The server compares against the previous refuel
   * on the same vehicle, so we use the same source (the driver's fuel history) rather than the
   * live telemetry odometer, which lags and drifts. Falls back to the shift's start reading.
   * This is advisory only — the authoritative check is server-side.
   */
  const [lastRefuelOdometer, setLastRefuelOdometer] = useState<number | undefined>()
  useEffect(() => {
    if (screen !== "refuel") return
    let cancelled = false
    void (async () => {
      try {
        const history = await services.refuel.listHistory()
        if (cancelled) return
        const readings = history
          .filter((h) => h.odometer_km != null)
          .map((h) => h.odometer_km as number)
        setLastRefuelOdometer(readings.length ? Math.max(...readings) : undefined)
      } catch {
        // Offline or unreachable: leave the hint unset rather than blocking the capture.
      }
    })()
    return () => {
      cancelled = true
    }
  }, [screen, services])
  // Training journey: the selected lesson and the lessons this session has completed. The lesson
  // catalogue (`GET /training/lessons`) is course-scoped and carries no per-driver enrolment — the
  // only endpoint that does (`GET /training/roster`) needs `training:review`, which a driver does
  // not hold — so the hub's completion badges are driven by the completions we ourselves recorded.
  const [lessonId, setLessonId] = useState<string>()
  const [completedLessons, setCompletedLessons] = useState<ReadonlySet<string>>(() => new Set<string>())

  const markLessonCompleted = useCallback((id: string) => {
    setCompletedLessons((prev) => (prev.has(id) ? prev : new Set([...prev, id])))
  }, [])
  // Onboarding gate: `undefined` while the record is still loading, so the driver never sees the
  // home hub flash before we know whether onboarding is outstanding.
  const [onboardingChecked, setOnboardingChecked] = useState(false)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const state = await services.onboarding.getState()
        if (cancelled) return
        if (!state.onboarding_complete) setScreen(resolveOnboardingStep(state))
      } catch {
        // Onboarding is unreachable (offline, or the driver record predates the flow): fall through
        // to the normal home hub rather than trapping the driver behind an unreachable gate.
      } finally {
        if (!cancelled) setOnboardingChecked(true)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [services])

  /** Advance to the next onboarding step, or finish and land on the home hub. */
  const advanceOnboarding = useCallback((from: OnboardingStep) => {
    const next = ONBOARDING_STEPS[ONBOARDING_STEPS.indexOf(from) + 1]
    setScreen(next ?? "home")
  }, [])

  const driverName = services.session.principal?.email ?? t("common.appName")

  const refresh = useCallback(async () => {
    try {
      setActive(await services.shifts.getActive())
    } catch {
      /* offline → no active shift */
    }
    const counts = await services.queue.counts()
    setOutboxCount(counts.pending + counts.inflight + counts.failedReview)
  }, [services])

  // Real-time + inbox wiring: connect the driver socket, bind feed handlers, and seed the inboxes.
  useEffect(() => {
    const feed = services.feed
    services.socket.connect("driver")
    feed.bindSocket()
    const sync = () => {
      setNotifications(feed.notifications)
      setAnomalies(feed.anomalies)
      setVehicle(feed.vehicle)
      setOnline(services.socket.status === "connected")
    }
    const off = feed.onChange(sync)
    const offStatus = services.socket.onStatusChange(sync)
    void services.feed.loadAnomalies()
    void services.feed.loadVehicleState(active?.vehicle_id)
    sync()
    return () => {
      off()
      offStatus()
      feed.dispose()
      services.socket.disconnect()
    }
  }, [services, active?.vehicle_id])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const handleError = (e: unknown) => setError(fromUnknown(e))
  const reportResult = (r: SubmitResult, queuedKey: string) => {
    if (r.kind === "queued") setToast(t(queuedKey))
    else setToast(undefined)
  }

  const submitClockIn = async (
    params: { start_odometer_km: number; start_fuel_gauge: import("@fleet/shared/mobile").FuelGaugeLevel },
    photo: CapturedPhoto,
  ) => {
    setLoading(true)
    setError(undefined)
    try {
      const r = await services.shifts.clockIn(
        { assignment_id: PLACEHOLDER_ASSIGNMENT_ID, start_odometer_km: params.start_odometer_km, start_fuel_gauge: params.start_fuel_gauge, consent_version: services.flow.config.consentVersion },
        photo,
      )
      reportResult(r, "driver.clockIn.queued")
      await refresh()
      setScreen("home")
    } catch (e) {
      handleError(e)
    } finally {
      setLoading(false)
    }
  }

  const submitClockOut = async (odometerKm: number, gauge: FuelGaugeLevel, photo: CapturedPhoto, notes: string) => {
    if (!active) return
    setLoading(true)
    setError(undefined)
    try {
      const r = await services.shifts.clockOut({ shift_id: active.shift_id, end_odometer_km: odometerKm, end_fuel_gauge: gauge, debrief_notes: notes || undefined }, photo)
      reportResult(r, "driver.clockOut.queued")
      await refresh()
      setScreen("home")
    } catch (e) {
      handleError(e)
    } finally {
      setLoading(false)
    }
  }

  /**
   * Photo-first refuel, step 6 (spec B3). Creates the purchase, then polls for the OCR result so
   * the review step has something to show — the backend queues OCR for a worker and cannot return
   * the parsed values in the 201 body. A queued (offline) submission has no server id yet, so it
   * skips straight to the confirmation; the driver reviews it later from fuel history.
   */
  const submitRefuel = async (payload: RefuelSubmitPayload) => {
    const vehicleId = active?.vehicle_id ?? vehicle?.vehicle_id
    if (!vehicleId) return
    setLoading(true)
    setError(undefined)
    try {
      const r = await services.refuel.submitPhotoFirst({
        shift_id: active?.shift_id ?? null,
        vehicle_id: vehicleId,
        odometer_reading: payload.odometer_reading,
        receipt: payload.receipt,
        odometerPhoto: payload.odometerPhoto,
        fuel_card_last_four: payload.fuel_card_last_four,
        purchased_at: new Date().toISOString(),
      })

      reportResult(r.kind === "queued" ? { kind: "queued", id: r.id } : { kind: "done", id: r.id }, "driver.refuel.queued")

      if (r.kind !== "done" || !r.fuelPurchaseId) {
        // Parked in the outbox: there is no purchase to review or correct yet.
        setRefuelPhase("done")
        return
      }

      setRefuelPurchaseId(r.fuelPurchaseId)
      // Show the OCR values the POST already carried, if any; otherwise poll for them.
      if (r.ocr) {
        setRefuelOcr(r.ocr)
        setRefuelPhase("review")
        return
      }
      setRefuelPhase("awaiting_ocr")
      const ocr = await services.refuel.pollOcr(r.fuelPurchaseId)
      setRefuelOcr(ocr)
      setRefuelPhase("review")
    } catch (e) {
      handleError(e)
      setRefuelPhase("capture")
    } finally {
      setLoading(false)
    }
  }

  /**
   * Photo-first refuel, steps 7–8. Persists any edits the driver made on the review step, then
   * lands on the success confirmation. A failed correction must not discard the purchase, which
   * is already recorded, so it surfaces as an error while the flow still completes.
   */
  const confirmRefuel = async (corrections?: RefuelCorrections) => {
    const purchaseId = refuelPurchaseId
    if (corrections && purchaseId) {
      const body = toFuelCorrection(corrections)
      if (Object.keys(body).length > 0) {
        setLoading(true)
        try {
          await services.refuel.correct(purchaseId, body)
        } catch (e) {
          handleError(e)
        } finally {
          setLoading(false)
        }
      }
    }
    setToast(t("driver.refuel.savedToast"))
    setRefuelPhase("done")
  }

  /** Leave the refuel journey and reset its local step/OCR state for the next run. */
  const closeRefuel = () => {
    resetRefuel()
    setScreen("home")
  }

  const submitInspection = async (
    params: { previous_defects_reviewed: boolean; signature_name: string; items: import("@fleet/shared/mobile").InspectionItemInput[] },
    evidence: Record<string, CapturedPhoto>,
  ) => {
    if (!active) return
    setLoading(true)
    setError(undefined)
    try {
      // Evidence photos (keyed by template_item_id) are uploaded by the service, which stamps the
      // resulting media_object_id onto each FAIL item; the local uri must never reach the payload.
      const r = await services.inspections.submit(
        { shift_id: active.shift_id, template_id: DEMO_TEMPLATE_ID, subject: "VEHICLE", vehicle_id: active.vehicle_id, previous_defects_reviewed: params.previous_defects_reviewed, signature_name: params.signature_name, items: params.items },
        { photos: evidence },
      )
      reportResult(r, "driver.dvir.queued")
      setScreen("home")
    } catch (e) {
      handleError(e)
    } finally {
      setLoading(false)
    }
  }

  const submitMayday = async (reason: string) => {
    setLoading(true)
    setError(undefined)
    try {
      await services.accidents.mayday({ shift_id: active?.shift_id ?? null, vehicle_id: active?.vehicle_id ?? null, position: { latitude: -1.2921, longitude: 36.8219 }, mayday_reason: reason })
      setToast(t("driver.accident.queued"))
      setScreen("home")
    } catch (e) {
      handleError(e)
    } finally {
      setLoading(false)
    }
  }

  const submitReport = async (statement: string, front: CapturedPhoto) => {
    setLoading(true)
    setError(undefined)
    try {
      const r = await services.accidents.report({ shift_id: active?.shift_id ?? null, vehicle_id: active?.vehicle_id ?? null, driver_statement: statement })
      if (r.kind === "done") await services.accidents.attachMedia(r.id ?? "", "FRONT_DAMAGE", front)
      reportResult(r, "driver.accident.queued")
      setScreen("home")
    } catch (e) {
      handleError(e)
    } finally {
      setLoading(false)
    }
  }

  /**
   * Driver-reported vehicle defect (spec `report_vehicle_issue`). Distinct from `submitReport`,
   * which opens an *accident* report: this posts to `POST /vehicles/{id}/issues` and never
   * escalates. The photo is optional, so it is passed straight through to the service (which
   * uploads it before the business POST, keeping a queued item replay-safe).
   */
  const submitVehicleIssue = async (payload: VehicleIssueSubmitPayload) => {
    const vehicleId = active?.vehicle_id ?? vehicle?.vehicle_id ?? ""
    if (!vehicleId) return
    setLoading(true)
    setError(undefined)
    try {
      const r = await services.vehicleIssue.report(vehicleId, {
        category: payload.category,
        severity: payload.severity,
        description: payload.description,
        shift_id: active?.shift_id ?? null,
        photo: payload.photo,
      })
      if (r.kind === "queued") setToast(t("driver.vehicleIssue.queued"))
      else setToast(t("driver.vehicleIssue.submitted"))
      setScreen("vehicle")
    } catch (e) {
      handleError(e)
    } finally {
      setLoading(false)
    }
  }

  if ((loading || !onboardingChecked) && screen === "home") {
    return (
      <View style={{ flex: 1, backgroundColor: theme.colors.ui01, justifyContent: "center", alignItems: "center" }}>
        <ActivityIndicator color={theme.colors.interactive01} />
      </View>
    )
  }

  // Toast (offline-queued confirmation). Rendered as a top banner above the active screen.
  const toastBanner = toast ? (
    <View style={{ backgroundColor: theme.colors.successContainer, padding: theme.spacing[3] }}>
      <Text style={{ color: theme.colors.onSuccessContainer }}>{toast}</Text>
    </View>
  ) : null

  const renderContent = (): React.ReactElement => {
    switch (screen) {
      case "clockIn":
        return <ClockInScreen consentVersion={services.flow.config.consentVersion} submitting={loading} error={error} onSubmit={submitClockIn} onCancel={() => setScreen("home")} />
      case "clockOut":
        return <ClockOutScreen shiftId={active?.shift_id ?? ""} submitting={loading} error={error} onSubmit={submitClockOut} onCancel={() => setScreen("home")} />
      case "refuel":
        return (
          <RefuelScreen
            vehicleId={active?.vehicle_id ?? vehicle?.vehicle_id ?? ""}
            shiftId={active?.shift_id ?? null}
            submitting={loading}
            error={error}
            lastOdometer={lastRefuelOdometer}
            ocr={refuelOcr}
            phase={refuelPhase}
            onSubmit={submitRefuel}
            onConfirm={confirmRefuel}
            onCancel={closeRefuel}
          />
        )
      case "inspection":
        return <InspectionScreen templateId="d1" vehicleId={active?.vehicle_id ?? ""} shiftId={active?.shift_id ?? ""} items={DEMO_TEMPLATE} submitting={loading} error={error} onSubmit={submitInspection} onCancel={() => setScreen("home")} />
      case "accident":
        return <AccidentScreen shiftId={active?.shift_id ?? null} vehicleId={active?.vehicle_id ?? null} submitting={loading} error={error} onMayday={submitMayday} onReport={submitReport} onCancel={() => setScreen("home")} />
      case "notifications":
        return (
          <NotificationsScreen
            notifications={notifications}
            onMarkRead={(id) => services.feed.markRead(id)}
            onMarkAll={() => services.feed.markAllRead()}
            onBack={() => setScreen("home")}
          />
        )
      case "anomalies":
        return <AnomaliesScreen anomalies={anomalies} loading={loading} onRefresh={() => void services.feed.loadAnomalies()} onBack={() => setScreen("home")} />
      case "vehicle":
        return (
          <VehicleStateScreen
            vehicle={vehicle}
            offline={!online}
            onBack={() => setScreen("home")}
            onReportIssue={() => setScreen("vehicleIssue")}
          />
        )
      case "vehicleIssue":
        return (
          <VehicleIssueScreen
            vehicleId={active?.vehicle_id ?? vehicle?.vehicle_id ?? ""}
            vehiclePlate={vehicle?.plate ?? null}
            submitting={loading}
            error={error}
            onSubmit={submitVehicleIssue}
            onCancel={() => setScreen("vehicle")}
          />
        )
      case "profile":
        return (
          <ProfileScreen
            services={services}
            email={driverName}
            onOpenOutbox={() => setScreen("outbox")}
            onMyShifts={() => setScreen("myShifts")}
            onDocuments={() => setScreen("documents")}
            onFuelHistory={() => setScreen("fuelHistory")}
            onDvirList={() => setScreen("dvirList")}
            onMyAccidents={() => setScreen("myAccidents")}
            onTraining={() => setScreen("training")}
            onRoleSwitch={onSwitchRole ? () => setScreen("roleSwitch") : undefined}
            onSwitchLocale={(l: Locale) => setLocale(l)}
            onLogout={onLogout}
            onBack={() => setScreen("home")}
          />
        )
      case "outbox":
        return (
          <OutboxScreen
            services={services}
            online={online}
            onCountsChanged={(c) => setOutboxCount(c.pending + c.inflight + c.failedReview)}
            onBack={() => setScreen("home")}
          />
        )
      case "myShifts":
        // No dedicated shift-detail screen yet (B.8): remember the selection for when it lands.
        return <MyShiftsScreen services={services} onSelect={(id) => setShiftId(id)} onBack={() => setScreen("home")} />
      case "fuelHistory":
        return <FuelHistoryScreen services={services} onSelect={() => undefined} onBack={() => setScreen("home")} />
      case "dvirList":
        return (
          <DvirListScreen
            services={services}
            onNew={() => setScreen("inspection")}
            onSelect={(id) => {
              setDvirId(id)
              setScreen("dvirDetail")
            }}
            onBack={() => setScreen("home")}
          />
        )
      case "dvirDetail":
        return <DvirDetailScreen services={services} id={dvirId ?? ""} onBack={() => setScreen("dvirList")} />
      case "myAccidents":
        return (
          <MyAccidentsScreen
            services={services}
            onSelect={(id) => {
              setAccidentId(id)
              setScreen("accidentDetail")
            }}
            onBack={() => setScreen("home")}
          />
        )
      case "accidentDetail":
        return <AccidentDetailScreen services={services} id={accidentId ?? ""} onBack={() => setScreen("myAccidents")} />
      case "documents":
        return <DocumentsScreen services={services} withinDays={30} onSelect={() => undefined} onBack={() => setScreen("home")} />
      case "training":
        return (
          <TrainingHubScreen
            services={services}
            driverName={driverName}
            completed={completedLessons}
            onOpenLesson={(id) => {
              setLessonId(id)
              setScreen("lessonDetail")
            }}
            onOpenResources={() => setScreen("resources")}
            onBack={() => setScreen("home")}
          />
        )
      case "lessonDetail":
        return (
          <LessonDetailScreen
            services={services}
            lessonId={lessonId ?? ""}
            completed={lessonId != null && completedLessons.has(lessonId)}
            onCompleted={markLessonCompleted}
            onBack={() => setScreen("training")}
          />
        )
      case "resources":
        return (
          <ResourceLibraryScreen
            services={services}
            onOpenLesson={(id) => {
              setLessonId(id)
              setScreen("lessonDetail")
            }}
            onBack={() => setScreen("training")}
          />
        )
      case "suspended":
        return <SuspendedScreen onLogout={onLogout} />
      case "offlinePin":
        return <OfflinePinScreen attemptsRemaining={3} locked={false} onUnlock={() => {}} onGoOnline={() => setScreen("home")} />
      case "roleSwitch":
        return (
          <RoleSwitchScreen
            currentRole="driver"
            // `App.tsx` swaps the mounted router on `role`; picking "driver" here is a no-op switch
            // that simply returns to the hub, picking "admin" unmounts this surface entirely.
            onSwitch={(role) => {
              if (role === "driver") setScreen("home")
              onSwitchRole?.(role)
            }}
            locale={getLocale()}
            onSwitchLocale={(l) => setLocale(l)}
          />
        )
      case "onboardingProfile":
        return <OnboardingProfileSetupScreen services={services} onNext={() => advanceOnboarding("onboardingProfile")} />
      case "onboardingBackground":
        return (
          <BackgroundCheckScreen
            services={services}
            onNext={() => advanceOnboarding("onboardingBackground")}
            onBack={() => setScreen("onboardingProfile")}
          />
        )
      case "onboardingVehicle":
        return <VehicleAssignmentScreen services={services} onNext={() => advanceOnboarding("onboardingVehicle")} />
      case "onboardingReady":
        return <ReadyToDriveScreen services={services} onComplete={() => setScreen("home")} />
      case "home":
      default:
        return (
          <DriverHomeScreen
            driverName={driverName}
            activeShift={active}
            pendingCloseout={false}
            offline={!online}
            outboxCount={outboxCount}
            onClockIn={() => setScreen(active ? "clockOut" : "clockIn")}
            onClockOut={() => setScreen("clockOut")}
            onRefuel={() => {
              resetRefuel()
              setScreen("refuel")
            }}
            onInspect={() => setScreen("inspection")}
            onAccident={() => setScreen("accident")}
            onNotifications={() => setScreen("notifications")}
            onAnomalies={() => setScreen("anomalies")}
            onVehicle={() => setScreen("vehicle")}
            onTraining={() => setScreen("training")}
            onResources={() => setScreen("resources")}
            onProfile={() => setScreen("profile")}
            onOpenOutbox={() => setScreen("outbox")}
          />
        )
    }
  }

  const titleFor: Record<DriverScreen, string> = {
    home: "common.appName",
    clockIn: "driver.clockIn.title",
    clockOut: "driver.clockOut.title",
    refuel: "driver.refuel.title",
    inspection: "driver.dvir.title",
    accident: "driver.accident.title",
    vehicleIssue: "driver.vehicleIssue.title",
    notifications: "notifications.title",
    anomalies: "driver.anomalies.title",
    vehicle: "driver.vehicle.title",
    profile: "driver.profile.title",
    myShifts: "driver.myShifts.title",
    fuelHistory: "driver.fuelHistory.title",
    dvirList: "driver.dvir.title",
    dvirDetail: "driver.dvir.title",
    myAccidents: "driver.accident.title",
    accidentDetail: "driver.accident.title",
    documents: "driver.documents.title",
    outbox: "outbox.title",
    training: "driver.training.hub.title",
    lessonDetail: "driver.training.lesson.title",
    resources: "driver.training.resource.title",
    suspended: "driver.suspended.title",
    offlinePin: "driver.offlinePin.title",
    roleSwitch: "driver.roleSwitch.title",
    onboardingProfile: "driver.onboarding.title",
    onboardingBackground: "driver.onboarding.title",
    onboardingVehicle: "driver.onboarding.title",
    onboardingReady: "driver.onboarding.title",
  }

  const bottomItems = [
    { key: "home" as DriverScreen, labelKey: "driver.tabs.home", icon: "home" as const, filledIcon: "home" as const },
    { key: "refuel" as DriverScreen, labelKey: "driver.tabs.refuel", icon: "local_gas_station" as const },
    { key: "inspection" as DriverScreen, labelKey: "driver.tabs.inspect", icon: "fact_check" as const },
    { key: "accident" as DriverScreen, labelKey: undefined as any, icon: "report_problem" as const },
    { key: "training" as DriverScreen, labelKey: "driver.tabs.training", icon: "school" as const },
    { key: "profile" as DriverScreen, labelKey: "driver.tabs.more", icon: "more_horiz" as const },
  ]

  /** Sub-screens that keep their parent tab lit while the driver is inside a journey. */
  const TAB_SUBSCREENS: Partial<Record<DriverScreen, readonly DriverScreen[]>> = {
    profile: ["notifications", "anomalies", "vehicle", "vehicleIssue", "profile", "outbox", "roleSwitch"],
    training: ["training", "lessonDetail", "resources"],
  }

  // Onboarding is a blocking, linear flow: the tab bar and the "back to home" arrow are suppressed
  // so the driver cannot skip into the hub before the record is complete.
  const onboarding = isOnboardingScreen(screen)

  /** Where the app-bar back arrow returns to: the parent journey step, or the home hub. */
  const backTarget: Partial<Record<DriverScreen, DriverScreen>> = {
    lessonDetail: "training",
    resources: "training",
    // The issue report is entered from the vehicle screen's quick-action row, so back returns there.
    vehicleIssue: "vehicle",
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.ui01 }}>
      <TopAppBar
        title={t(titleFor[screen])}
        centered
        leading={screen !== "home" && !onboarding ? { icon: "arrow_back", label: t("common.back"), onPress: () => setScreen(backTarget[screen] ?? "home") } : undefined}
        trailing={
          onboarding
            ? []
            : [
                { icon: "notifications", label: t("notifications.title"), onPress: () => setScreen("notifications"), badge: notifications.some((n) => !n.read) },
              ]
        }
      />
      {toastBanner}
      {/* Shell-level offline/needs-review banner: the Outbox stays one tap away from every driver
          screen, not just the home hub (which renders its own copy inside the hero scroll view). */}
      {onboarding || screen === "home" || screen === "outbox" ? null : (
        <OfflineBanner
          online={online}
          counts={{ pending: outboxCount, inflight: 0, failedReview: 0, done: 0, total: outboxCount }}
          onOpenOutbox={() => setScreen("outbox")}
        />
      )}
      <View style={{ flex: 1 }}>{renderContent()}</View>
      {onboarding ? null : (
        <BottomNav
          items={bottomItems.map((b) => ({
            key: b.key,
            label: t((b.labelKey ?? "driver.tabs.more") as any),
            icon: b.icon,
            filledIcon: b.filledIcon,
            active: screen === b.key || (TAB_SUBSCREENS[b.key]?.includes(screen) ?? false),
            onPress: () => {
              // Re-entering Refuel from the tab bar always starts a fresh photo-first run.
              if (b.key === "refuel") resetRefuel()
              setScreen(b.key)
            },
          }))}
        />
      )}
    </View>
  )
}
