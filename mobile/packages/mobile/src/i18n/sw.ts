/** ASSUMPTION[D-02]: the Swahili copy has not been reviewed by a native speaker. It is grammatically
 *  complete and every key exists, but register and idiom need a human pass. */
import type { Dict } from './en';
export const sw: Dict = {
  app: { loading: 'Inapakia', cancel: 'Ghairi', },
  auth: { emailOrPhone: 'Barua pepe au namba ya simu', loginHelp: 'Namba ya simu yako au barua pepe ya kazi, na nenosiri lako.', chooseExperience: 'Ungependa kutumia Helix vipi?', splashHint: 'Inakagua kuingia kwako…', suspendedTitle: 'Akaunti imesimamishwa', password: 'Nenosiri', logIn: 'Ingia', showPassword: 'Onyesha nenosiri', hidePassword: 'Ficha nenosiri', consentTitle: 'Idhini ya ufuatiliaji wa GPS', accept: 'Kubali na uendelee', decline: 'Kataa', suspended: 'Akaunti yako imesimamishwa. Wasiliana na msimamizi wa kampuni.', logOut: 'Toka', continueDriver: 'Endelea kama dereva', continueAdmin: 'Endelea kama msimamizi', mfaCode: 'Msimbo', mfaHelp: 'Weka nambari ya tarakimu 6 uliyotumwa, au msimbo mmoja wa kurejesha.', verify: 'Thibitisha', continue: 'Endelea', signUp: 'Unda kampuni', companyName: 'Jina la kampuni', forgotPassword: 'Umesahaulisha nenosiri?', passwordReset: 'Rudisha nenosiri', passwordResetHelp: 'Weka barua pepe au namba ya simu ili upate msimbo wa kurudisha.', passwordResetCode: 'Weka msimbo na nenosiri jipya.', passwordResetDone: 'Nenosiri limebadilishwa kwa mafanikio.' },
  nav: { home: 'Nyumbani', refuel: 'Mafuta', inspect: 'Ukaguzi', accidents: 'Ajali', more: 'Zaidi', map: 'Ramani', },
  shift: { workPlan: 'Mpango wa zamu hii (si lazima)', clockedIn: 'Umeingia kwenye zamu', phoneFallback: 'Shiriki mahali pangu', phoneFallbackHelp: 'Helix inatuma mahali yako programu ikiwa wazi na ukiwa kwenye zamu. Ukifunga programu, inasimama.', vehicle: 'Gari {{plate}}', noAssignmentHint: 'Bado hukupewa gari. Wasiliana na msimamizi.', retakePhoto: 'Chukua picha nyingine', notes: 'Maelezo (si lazima)', restUntil: 'Mapumziko ya lazima hadi {{time}}', clockIn: 'Anza zamu', clockOut: 'Maliza zamu', noShift: 'Hakuna zamu inayoendelea', onDuty: 'Kazini tangu {{time}}', odometer: 'Odomita (km)', photo: 'Picha ya odomita na kipimo cha mafuta', assignment: 'Kazi uliyopewa' },
  outbox: { title: 'Kisanduku cha kutuma', flush: 'Tuma sasa', retry: 'Jaribu tena', edit: 'Hariri', discard: 'Futa', discardedToast: 'Badiliko lililorudiwa limefutwa.' },
  offline: { banner: 'Huna intaneti. Mabadiliko yamehifadhiwa na yatatumwa ukipata mtandao.', },
  status: { QUARANTINED: 'Imewekwa karantini', OFFLINE: 'Haipo mtandaoni', HOS_ALERT: 'Tahadhari ya mapumziko', SPEEDING: 'Mwendo kasi', MOVING: 'Inatembea', IDLING: 'Injini inawaka', PARKED: 'Imeegeshwa', OPERATIONAL: 'Inafanya kazi' },
  actions: { cancel: 'Ghairi', save: 'Hifadhi', submit: 'Tuma', OPEN_CLOCKOUT: 'Nenda kumaliza zamu', OPEN_SHIFT: 'Nenda kwenye zamu yangu', REFRESH: 'Sasisha', VIEW_FLAGS: 'Ona alama', RETRY: 'Jaribu tena', EDIT: 'Sahihisha na utume', DISCARD: 'Futa', CONTACT_ADMIN: 'Wasiliana na msimamizi', RELOGIN: 'Ingia tena', WAIT: 'Subiri, kisha jaribu tena', GIVE_CONSENT: 'Soma idhini', REGISTER_DEVICE: 'Sajili kifaa hiki', MFA: 'Weka nambari', CONTINUE: 'Endelea' },
  forms: { pickCard: 'Kadi gani?', pooled: 'ya pamoja', outOfRange: 'Lazima iwe kati ya {{min}} na {{max}}.', odometerLower: 'Hilo ni chini ya usomaji wa awali ({{last}} km). Angalia.', odometerJump: 'Hilo ni km {{km}} zaidi ya usomaji wa awali. Angalia.', lastReading: 'mwzo {{km}} km',titleRefuel: 'Rekodi ununuzi wa mafuta', titleInspect: 'Ukaguzi wa kila siku', retake: 'Chukua tena', useTemplate: 'Tumia orodha hii', noTemplateItems: 'Orodha hii bado haina vipengele kwenye mfumo. Omba msimamizi kabla ya kutuma.', purchasedAt: 'Ulipopewa mafuta lini (YYYY-MM-DDTHH:mmZ)', badNumber: 'Weka nambari, mfano 45.5', wholeNumber: 'Weka kilomita nzima, mfano 12345.', discardTitle: 'Tupa mabadiliko?', discardBody: 'Ulichoingiza kwenye skrini hii kitapotea.', keepEditing: 'Endelea kuhariri', discard: 'Tupa', flagged: 'Imewekwa alama ya kupitiwa: {{items}}', missing: 'Bado inahitajika: {{items}}', gaugeBeforePct: 'Kipimo cha mafuta kabla (%)', gaugeAfterPct: 'Kipimo cha mafuta baada (%)', percentRange: 'Weka nambari kutoka 0 hadi 100.', optional: 'si lazima', submit: 'Tuma', litres: 'Lita', cost: 'Gharama jumla (KES)', cardLast4: 'Kadi ya mafuta, tarakimu 4 za mwisho', station: 'Kituo', gaugeBefore: 'Picha ya kipimo kabla ya kuweka mafuta', gaugeAfter: 'Picha ya kipimo baada ya kuweka mafuta', receipt: 'Picha ya risiti', template: 'Orodha ya ukaguzi', pass: 'Sawa', fail: 'Imefeli', na: 'Haihusu', notes: 'Maelezo', defectsReviewed: 'Nimepitia kasoro za awali', signature: 'Jina lako kamili (sahihi)', itemPhoto: 'Picha ya kasoro', noTemplates: 'Hakuna orodha ya ukaguzi iliyopewa gari hili.', queued: 'Imehifadhiwa. Itatumwa ukipata mtandao.', sent: 'Imetumwa.' },
  accident: { severity: 'Ukubwa wa ajali', MINOR: 'Ndogo', MODERATE: 'Wastani', SEVERE: 'Kubwa', slot: { FRONT_DAMAGE: 'mbele', REAR_DAMAGE: 'nyuma', SIDE_DAMAGE: 'pembeni', OTHER_VEHICLE_PLATE: 'namba ya gari lingine' }, mayday: 'Mayday: Nahitaji msaada sasa', maydayHelp: 'Hutuma eneo lako mara moja. Hakuna picha zinazohitajika.', reason: 'Nini kimetokea?', statement: 'Eleza kilichotokea', witness: 'Jina la shahidi', witnessPhone: 'Simu ya shahidi', plate: 'Namba ya gari lingine', report: 'Tuma ripoti ya ajali', sendMayday: 'Tuma Mayday', noGps: 'Washa eneo ili kutuma mahali ulipo.', addPhoto: 'Ongeza picha ya uharibifu' },
  admin: { accidents: 'Ajali', verify: 'Thibitisha', flag: 'Weka alama', reject: 'Kataa', clearPayment: 'Idhinisha malipo', acknowledge: 'Pokea', telemetry: 'Kagua mnyororo wa telemetria', telemetryOk: 'Mnyororo wa telemetria uko salama.', telemetryBad: 'Mnyororo wa telemetria una mapengo au mabadiliko.', emptyDvir: 'Hakuna ukaguzi unaosubiri.', emptyFuel: 'Hakuna manunuzi yanayosubiri.', emptyAccidents: 'Hakuna ajali zilizo wazi.', loadMore: 'Pakia zaidi', mayday: 'Mayday', addMedia: 'Ongeza picha' },
  hardware: { title: 'Unganisha kifaa cha ufuatiliaji', scanQr: 'Skannaa koodi ya QR kwenye kifaa', scanning: 'Elekeza kamera kwenye koodi ya QR', scanHint: 'Usimamizi wa QR hauwezi kufanya kazi kwenye kivinjari.', scanAgain: 'Skanna tena', enterManually: 'Weka IMEI wewe mwenyewe', imei: 'IMEI ya kifaa (tarakimu 15)', brand: 'Aina ya kifaa', sim: 'Namba ya SIM (hiari)', vehicle: 'Gari', pickVehicle: 'Chagua gari kwanza', pair: 'Unganisha kifaa', paired: 'Kifaa kimeunganishwa. Tuma ujumbe wa SMS kwenye SIM, kisha fungua na funga kifaa.', enableCamera: 'Wezesha kamera' },
  notifications: { empty: 'Hakuna arifa bado.', markAllRead: 'Weka zote zimesomwa', unread: 'Hazijasomwa' },
  anomalies: { title: 'Alama', empty: 'Hakuna kilichowekwa alama.', all: 'Zote', FUEL: 'Mafuta', HOS: 'Saa za mapumziko', ACCIDENT: 'Ajali', MAINTENANCE: 'Matengenezo', SECURITY: 'Usalama', INFO: 'Taarifa', WARNING: 'Onyo', ALERT: 'Tahadhari', LOW: 'Ndogo', MEDIUM: 'Wastani', HIGH: 'Juu', CRITICAL: 'Safi' },
  vehicle: { title: 'Magari', none: 'Anza zamu ili kuona gari lako.', stale: 'Masasisho ya moja kwa moja yamesimama. Inasasisha kila sekunde 15.', create: 'Ongeza gari', edit: 'Hariri', reportIssue: 'Ripoti tatizo', issues: 'Matatizo', noIssues: 'Hakuna matatizo yaliyoTathminiwa.', toggleOperational: 'Badilisha hali', plate: 'Namba ya leseni', make: 'Kipengele', model: 'Aina', class: 'Darasa', nonOperationalReason: 'Sababu ya kutokuwa na uendeshaji' },
  profile: { title: 'Wasifu', language: 'Lugha', consent: 'Idhini ya ufuatiliaji wa GPS', resetPin: 'Weka PIN ya nje ya mtandao', pinSaved: 'PIN ya nje ya mtandao imehifadhiwa.', biometric: 'Fungua kwa alama ya kidole au uso', openOutbox: 'Fungua kisanduku cha kutuma', setupMfa: 'Weka uthibitisho wa hatua mbili', edit: 'Hariri wasifu', licenceNumber: 'Namba ya leseni', licenceClass: 'Daraja la leseni', emergencyName: 'Jina la mtu wa dharura', emergencyPhone: 'Namba ya mtu wa dharura', save: 'Hifadhi mabadiliko', saved: 'Wasifu umenhifadhiwa.', backgroundCheck: 'Utafiti wa historia', bgProvider: 'Jina la mtoa huduma', bgConsent: 'Ninakubali utafiti huu', bgSubmit: 'Wasilisha utafiti', bgSubmitted: 'Utafiti umewasilishwa.', training: 'Maendeleo ya mafunzo', revokeDevice: 'Ondoa kifaa hiki', passwordSaved: 'Nenosiri limebadilishwa.' },
  pin: { title: 'Weka PIN yako', attempts: 'Umebakiwa na majaribio {{n}} kabla ya kufungiwa dakika 15', locked: 'Imefungwa. Jaribu tena baada ya {{time}}.', wiped: 'PIN imeondolewa. Ingia kwa nenosiri.', loginInstead: 'Ingia kwa nenosiri' },
  mfa: { title: 'Uthibitisho wa hatua mbili', body: 'Helix itatuma nambari ya tarakimu 6 kila unapoingia, kwa SMS kwa madereva na kwa barua pepe kwa wafanyakazi. Hifadhi misimbo ya kurejesha hapa chini.', password: 'Thibitisha nenosiri lako', start: 'Washa uthibitisho wa hatua mbili', deliveredCodeHelp: 'Uthibitisho wa hatua mbili umewashwa. Hifadhi misimbo hii mahali salama.', recoveryHelp: 'Ihifadhi sasa. Inaonyeshwa mara moja. Kila mmoja hufanya kazi mara moja.', },
  drivers: { title: 'Madereva', empty: 'Hakuna madereva.', active: 'Hai', suspended: 'Amesimamishwa', mfa: 'Hatua mbili imewashwa', noMfa: 'Hatua mbili imezimwa', lastLogin: 'Aliingia mwisho', revokeDevice: 'Ondoa kifaa', revokeSessions: 'Toa kila mahali', suspend: 'Simamisha', reinstate: 'Rudisha', devices: 'Vifaa', confirm: 'Thibitisha', create: 'Ongeza dereva', email: 'Barua pepe', created: 'Dereva ameongezwa.', pending: 'Inasubiri kuidhinishwa', approve: 'Idhinisha', approved: 'Dereva ameidhinishwa.' },
  docs: { title: 'Nyaraka zinazoisha', empty: 'Hakuna kinachoisha karibuni.', days: 'Siku {{n}} zimebaki', expired: 'Imeisha', renewalNote: 'Dokezo la kufanyiza upya', note: 'Dokezo', saveNote: 'Hifadhi dokezo', noteSaved: 'Dokezo limehifadhiwa.' },
  security: { hooked: 'Zana za kuchunguza au kuingilia programu zimegunduliwa, kwa hiyo Helix haiwezi kuanza.', pinningMissing: 'Muunganisho salama haujawekwa kwenye toleo hili.', blockedTitle: 'Kifaa hiki hakiwezi kutumika', blockedBody: 'Fleet huzuia vifaa vilivyovunjwa ulinzi ili kulinda data ya dereva na gari.', registered: 'Kifaa hiki kimesajiliwa.', rooted: 'Kifaa hiki kimevaunjika (rooted/jailbroken).' },
  swap: { pickExisting: 'Chukua trela iliyopo', noTrailers: 'Hakuna trela inayopatikana kwa sasa.', newTrailer: 'Au ongeza mpya', addNew: 'Trela mpya', type_DRY_VAN: 'Bokiti kavu', type_REEFER: 'Jokofu', type_FLATBED: 'Flatbed', type_LOWBOY: 'Lowboy', type_TANKER: 'Tanki', type_CURTAIN_SIDE: 'Curtain side', type_OTHER: 'Nyingine', title: 'Kubadilisha trela', bobtail: 'Acha trela (bila trela)', plate: 'Namba ya trela mpya', type: 'Aina ya trela', hookPhoto: 'Picha ya kiunganishi cha ndoano', inspection: 'Kitambulisho cha ukaguzi wa ndoano (UUID)' },
  detail: { blockerItem: 'Mbaya: kushindwa kwa bidhaa hii kunasabisha gari kuzimwa.', tierShort: 'Ngazi {{n}}', evidence: 'Ushahidi', expires: 'Inaisha', tier: 'Ngazi ya kupandisha', timers: 'Vipima muda vya kupandisha', acked: 'Imepokelewa', notAcked: 'Bado haijapokelewa', photo: 'Picha', noPhoto: 'Hakuna picha', gaugeBefore: 'Kipimo kabla', gaugeAfter: 'Kipimo baada', gaugeDelta: 'Mabadiliko', adjustLitres: 'Rekebisha lita (si lazima)', rejectReason: 'Sababu ya kukataa', openRelated: 'Fungua husika', failed: 'Imefeli', passed: 'Imepita', na: 'Haihusu', quarantine: 'Sababu ya karantini', hos: 'Saa za mapumziko', position: 'Mahali pa mwisho', due: 'Inabaki', overdue: 'Imechelewa', noData: 'Hakuna maelezo.', document: 'Namba ya nyaraka', issuerName: 'Mtoaji', },
  importer: { title: 'Ingiza taarifa ya mafuta', provider: 'Mtoa huduma (mfano benki)', periodStart: 'Mwanzo wa kipindi (YYYY-MM-DD)', periodEnd: 'Mwisho wa kipindi (YYYY-MM-DD)', pick: 'Chagua faili ya CSV', picked: 'Faili: {{name}}', mapping: 'Majina ya safu kwenye CSV yako', date: 'Safu ya tarehe', amount: 'Safu ya kiasi', card: 'Safu ya kadi', litres: 'Safu ya lita', station: 'Safu ya kituo', submit: 'Ingiza', done: 'Taarifa imeingizwa.', badDate: 'Tumia YYYY-MM-DD.' },
  profileExtra: { deviceId: 'Kitambulisho cha kifaa', name: 'Umeingia kama', consentVersion: 'Toleo {{v}} limekubaliwa {{date}}', consentUnknown: 'Hakuna idhini iliyorekodiwa kwenye kifaa hiki', model: 'Kifaa', app: 'Toleo la programu', },
  shifts: { title: 'Zamu za kuthibitisha', empty: 'Hakuna zamu zinazolingana na vichujio hivi.', date: 'Tarehe', status: 'Hali', state: 'Hali ya zamu', PENDING: 'Inasubiri', VERIFIED: 'Imethibitishwa', FLAGGED: 'Imewekwa alama', OPEN: 'Wazi', PENDING_CLOSEOUT: 'Kufunga kunasubiri', CLOSED: 'Imefungwa', distance: 'Umbali', duration: 'Muda', clockIn: 'Alianza', clockOut: 'Alimaliza', km: 'km {{n}}', hours: 'saa {{h}} dak {{m}}', flagReason: 'Kwa nini unaweka alama kwenye zamu hii?', today: 'Leo', anyDate: 'Tarehe yoyote', workPlan: ' Mpango wa kazi', noPlan: 'Hakuna maelezo ya mpango.', forceClose: 'Funga zamu kwa nguvu', forceCloseReason: 'Sababu ya kufunga kwa nguvu (si lazima)' },
  state: { dismiss: 'Funga', loading: 'Inapakia', offlineCopy: 'Nakala ya nje ya mtandao', pending: 'Inasubiri', waitSeconds: 'Subiri sekunde {{n}}' },
  alerts: { mayday: 'MAYDAY: dereva anahitaji msaada', maydayOpen: 'Fungua', accidentUpdate: 'Taarifa ya msaada: {{status}}', dismiss: 'Funga' },
  mayday: { hold: 'Shikilia kutuma Mayday', holding: 'Endelea kushikilia…', sent: 'Mayday imetumwa. Msaada unaarifiwa.', queued: 'Mayday imehifadhiwa. Itatumwa mara tu utakapopata mtandao.', hint: 'Hutuma eneo lako. Shikilia sekunde 2 ili isitumwe kwa bahati mbaya.', failed: 'Mayday haikuweza kutumwa. Jaribu tena au omba msaada kwa simu.', noGps: 'Washa eneo ili msaada ukupate.' },
  inbox: { title: 'Kikasha', notifications: 'Arifa', flags: 'Alama', docs: 'Nyaraka' },
  settings: { on: 'Imewashwa', off: 'Imezimwa', account: 'Akaunti', security: 'Usalama', device: 'Kifaa hiki', data: 'Data', switchRole: 'Badilisha kuwa {{role}}', roleDRIVER: 'dereva', roleADMIN: 'msimamizi', logoutWarn: 'Una mabadiliko yasiyotumwa. Kutoka kutayahifadhi hadi utakapoingia tena kwenye kifaa hiki. Gusa tena kutoka.', readOnly: 'Unaweza kuona hili lakini si kulibadilisha.', changePassword: 'Badilisha nenosiri', newPassword: 'Nenosiri jipya', profile: 'Wasifu na ufunguo' },
  tabs: { overview: 'Muhtasari', review: 'Mapitio' },
  review: { shifts: 'Zamu', inspections: 'Ukaguzi', fuel: 'Mafuta' },
  dash: { attention: 'Yanayohitaji uangalizi', fleet: 'Hali ya magari sasa' },
  dashDetail: { title: 'Uchambuzi', distanceKm: 'Umbali (km)', fuelCost: 'Gharama ya mafuta', anomalies: 'Alama', vehicles: 'Magari', drivers: 'Madereva' },
  issue: { category: 'Kategoria', severity: 'Kali', description: 'Maelezo', descriptionPlaceholder: 'Una tatizo gani?', status: 'Hali', categoryMechanical: 'Kiufundi', categoryElectrical: 'Umeme', categoryTyre: 'Gairi', categoryBody: 'mwili wa gari', categoryOther: 'Nyingine', severityLow: 'Chini', severityMedium: 'Wastani', severityHigh: 'Juu' },
  training: { title: 'Mafunzo', roster: 'Orodha', viewDetail: 'Ona', mandatory: 'Lazima', duration: 'Muda', minutes: 'dakika', complete: 'Kamilisha', status: 'Hali', statusCompleted: 'Kimekamilika', statusInProgress: 'Inaendelea', statusNotStarted: 'Hajaaanzishwa', completedAt: 'Imekamilika saa' },
  maintenance: { title: 'Matengenezo', record: 'Rekodi kazi ya matengenezo', viewDetail: 'Ona', taskId: 'ID ya kaji', vehicleId: 'ID ya gari', vendor: 'Mtoa huduma', cost: 'Gharama', notes: 'Maelezo' },
  privacy: { title: 'Faragha', requestExport: 'Tibu hitilafu ya data', exportHelp: 'Tutaweza kutayarisha faili yenye data yako na kukuabiria utakapokuwa Tayarini.', notes: 'Maelezo (si lazima)', notesPlaceholder: 'Sababu ya kupata', submit: 'Tuma', myRequests: 'Ombi zangu', noRequests: 'Hakuna ombi bado.', tenantRequests: 'Ombi zote', createdAt: 'Imechelwa' },
  gauge: { label: 'Usomaji wa kipimo cha mafuta', EMPTY: 'Tupu', QUARTER: 'Robo', HALF: 'Nusu', THREE_QUARTER: 'Robo tatu', FULL: 'Imejaa' },
  consent: { body: 'Unapokuwa kwenye zamu, Helix inarekodi saa zako za kazi ili kampuni iwe na kumbukumbu sahihi ya muda wa kuendesha na mahali gari ilipokuwa.' },
  errors: {
    // ── session / identity ──
    UNAUTHENTICATED: 'Barua pepe au nenosiri si sahihi.',
    SESSION_REVOKED: 'Kuingia kwako kumemaliza. Tafadhali ingia tena.',
    SESSION_LIMIT: 'Vifaa vingi sana vimeingia. Omba msimamizi atufe vifaa vya zamani.',
    ACCOUNT_SUSPENDED: 'Akaunti imesimamishwa. Wasiliana na msimamizi.',
    DEVICE_REVOKED: 'Kifaa hiki hakiruhusiwi tena. Wasiliana na msimamizi.',
    IP_BLOCKED: 'Mtandao huu umezuiwa kwa muda. Subiri kidogo kisha jaribu tena.',
    MFA_REQUIRED: 'Weka nambari ya tarakimu 6 uliyotumwa.',
    CONSENT_REQUIRED: 'Kubali idhini ya ufuatiliaji wa GPS ili uendelee.',
    OFFLINE_PIN_LOCKED: 'PIN imekosewa mara nyingi. Jaribu tena baada ya dakika 15.',
    OFFLINE_AUTH_EXPIRED: 'Umekaa nje ya mtandao muda mrefu. Ingia ili uendelee.',

    // ── authorisation / request shape ──
    FORBIDDEN: 'Huna ruhusa ya kufanya hili.',
    NOT_FOUND: 'Kile hakipo tena.',
    VALIDATION_ERROR: 'Angalia sehemu zilizoangaziwa.',
    DUPLICATE: 'Kimekwisha kurekodiwa.',
    RATE_LIMITED: 'Majaribio mengi mno. Jaribu tena baadaye.',
    SERVICE_UNAVAILABLE: 'Seva ni busy. Jaribu tena.',

    // ── idempotency ──
    IDEMPOTENCY_CONFLICT: 'Badiliko hili tayari lilitumwa kwa taarifa tofauti.',
    IDEMPOTENCY_INFLIGHT: 'Badiliko hili bado likiendelea kuhifadhiwa. Itajaribiwa tena.',

    // ── shift domain ──
    CLOCKOUT_PENDING: 'Zamu ya awali bado haijafungwa. Ikamilishe kwanza.',
    SHIFT_ALREADY_OPEN: 'Tayari una zamu iliyofunguliwa. Ifunge kwanza.',
    UNLOCK_REQUIRED: 'Rekodi hii imefungwa. Mwombe msimamizi aifungue.',
    NO_ASSIGNMENT: 'Hukupewa gari bado. Wasiliana na msimamizi.',
    HOS_REST_BLOCKED: 'Uko kwenye kipindi cha lazima cha mapumziko.',
    ODOMETER_DECREASED: 'Odomita haiwezi kuwa chini ya usomaji uliopita. Angalia tena.',
    ODOMETER_DIVERGENCE: 'Odomita hailingani na kihisi. Msimamizi atakagua.',
    WORK_PLAN_REQUIRED: 'Mpango wa kazi unahitajika kabla ya kumaliza zamu.',

    // ── inspection / fuel / media ──
    DVIR_FAIL_NEEDS_PHOTO: 'Ongeza picha kwa kila kipengee kilichofeli.',
    DEFECTS_NOT_REVIEWED: 'Thibitisha umepitia kasoro za awali.',
    MEDIA_QUARANTINED: 'Faili hii haiwezi kufunguliwa. Wasiliana na msimamizi.',

    // ── onboarding ──
    ONBOARDING_PROFILE_EMPTY: 'Jaza jina lako na namba ya kitambulisho kwanza.',
    ONBOARDING_CONSENT_REQUIRED: 'Kubali taarifa ya uchakataji ili uendelee.',
    BACKGROUND_CHECK_ALREADY_CLEARED: 'Ukaguzi waHistoria yako tayari umefanyika.',

    // ── local only ──
    DEPENDENCY_FAILED: 'Hatua iliyotangulia haikukamilika. Futa na uiweke tena.',
    UPLOAD_UNAVAILABLE: 'Upakiaji wa picha haujawa tayari. Jaribu tena.',
    UNKNOWN: 'Kuna tatizo. Jaribu tena.',
  },
  /** Alama zinazoonyeshwa kando ya kitu kilichohifadhiwa kwa mafanikio, si kama hitilafu. */
  signals: {
    fuelAnomalyCritical: 'Kipimo cha mafuta kiko nje ya kawaida. Msimamizi atakagua.',
    gaugeDeltaHigh: 'Badiliko la kipimo cha mafuta linaonekana kubwa mno.',
    fuelPriceSpike: 'Bei ya mafuta ni kubwa kuliko inavyotarajiwa.',
    blockerDefect: 'Kasoro kubwa. Gari limewekwa karantini.',
    offShiftMovement: 'Gari hili limesogea bila zamu kuu.',
    trackerOffline: 'Kihisi kimeacha kuripoti.',
    unknown: 'Alama imewekwa kwenye rekodi hii.',
  },
};
