import type { AutomationCopy } from "../automationCopy";
import type { HubCopy } from "../hubCopy";

export const hub: HubCopy = {
  workspace: "Espacio de la cuenta",
  library: "Impulsar tiempo de juego",
  farming: "Farmeo de cromos",
  offers: "Gratis para siempre",
  account: "Cuenta y seguridad",
  activeGames: "Notificados a Steam ahora",
  activeGamesShort: "Juegos activos",
  activeGamesScroll: "Juegos activos; desplázate en horizontal para ver más",
  noActiveGames: "Ahora mismo no se notifica ningún juego a Steam.",
  logsShort: "Registros",
  stopShort: "Desconectar",
  disconnect: "Desconectar de Steam",
  activityBoosting: "Impulsando tiempo de juego",
  activityFarming: "Farmeando cromos",
  activityOnline: "En línea, sin juego",
  switchConfirm: "Cambiar de modo",
  confirmSwitch:
    "¿Detener el farmeo de cromos y reanudar el tiempo de juego de tu selección manual guardada? El farmeo no se reiniciará automáticamente.",
  switchApply:
    "El farmeo de cromos está activo. Aplicar esta selección manual detiene el farmeo y cambia esta cuenta a tiempo de juego manual. ¿Continuar?",
  switchSettings:
    "El farmeo de cromos está activo. Cambiar estos ajustes de la cuenta detiene el farmeo y vuelve a la selección manual guardada. ¿Continuar?",
  switchPreset:
    "El farmeo de cromos está activo. Aplicar este preajuste detiene el farmeo y cambia esta cuenta a la selección manual del preajuste. ¿Continuar?",
  farmingSelectionHint:
    "El farmeo de cromos está activo. Esta es tu selección manual guardada. Aplicarla detiene el farmeo; cambiar de pestaña no cambia la actividad actual.",
  savedSelection: "Juegos manuales guardados",
  savedSelectionHint:
    "Guardados para el tiempo de juego manual; el farmeo usa los juegos de arriba.",
  farmingStatusHint:
    "El farmeo de cromos controla los juegos activos de arriba. Tu selección manual sigue disponible en Impulsar tiempo de juego.",
  navLabel: "Secciones de la cuenta",
  navActivity: "Juegos",
  navItems: "Objetos",
  navDiscover: "Descubrir",
  navAccount: "Cuenta",
  inventoryNav: "Inventario",
  listings: "Ofertas en el mercado",
  rules: "Reglas de precio",
  dropsCount: "{count} drops",
  modeLabel: "Actividad notificada a Steam",
  modeNone: "Nada",
  modeNoneOnline: "En línea, sin juego",
  modeNoneOffline: "Sin conexión",
  modeBoost: "Impulsar tiempo de juego",
  modeBoostGames: "{count} de {limit} juegos",
  modeBoostEmpty: "Elige juegos primero",
  modeFarm: "Farmear cromos",
  modeFarmDrops: "{drops} drops en {games} juegos",
  modeFarmNoDrops: "No se encontraron drops de cromos",
  modeFarmUnknown: "Drops de cromos aún sin comprobar",
  modeFarmUnavailable: "Abre el farmeo de cromos para comprobar los drops",
  modeExplain:
    "Steam guarda una sola lista de juegos en ejecución por cuenta, así que solo funciona un modo a la vez. La selección del otro modo se queda guardada.",
  confirmFarming:
    "¿Cambiar a farmeo de cromos? Se detiene el tiempo de juego de tus {count} juegos seleccionados; la selección se queda guardada. Cuando se recojan todos los drops, la cuenta se pausa.",
  confirmFarmingIdle:
    "¿Empezar el farmeo de cromos? Cuando se recojan todos los drops, la cuenta se pausa.",
  farmingConfirm: "Empezar a farmear",
  confirmIdle:
    "¿Dejar de notificar juegos a Steam? La cuenta sigue conectada y en pausa; tus selecciones se quedan guardadas.",
  idleConfirm: "Pausar",
  reloginTitle: "Volver a iniciar sesión: {name}",
  reloginDescription:
    "Inicia sesión con la misma cuenta de Steam. Tus selecciones, preajustes y ajustes se quedan guardados.",
  reloginBannerTitle: "Steam cerró la sesión",
  reloginBannerText:
    "Pasa tras un cambio de contraseña o cuando la sesión caduca. Inicia sesión una vez y el impulso, el farmeo y el inventario funcionarán como antes. Tus selecciones se quedan guardadas.",
  reloginQr: "Volver a iniciar sesión (código QR)",
  reloginPassword: "Con contraseña",
  steamMessage: "Steam dice: {message}",
  navAutomation: "Automatización",
  sectionSelect: "Sección",
  presets: "Preajustes",
  schedules: "Horarios",
  analytics: "Estadísticas",
  inventoryDescription:
    "Tus objetos de Steam agrupados por juego y set de insignia. Elige duplicados para la cesta de venta.",
  listingsDescription:
    "Objetos que ofreces ahora en el Mercado de la Comunidad de Steam.",
  rulesDescription: "Cómo calcula SteamBee el precio cuando vendes.",
  accountDescription:
    "Perfil de Steam, límites de tiempo de juego y estado de conexión de esta cuenta.",
  stateTitle: "Estado",
  steamProfile: "Perfil de Steam",
  dangerTitle: "Eliminar cuenta",
  dangerText:
    "Borra el inicio de sesión y los ajustes de esta cuenta en SteamBee.",
  lastEvent: "Último evento",
  noEvents: "Aún no hay eventos",
  activeGamesState: "Juegos activos",
  boostingSince: "Impulsando desde",
  visibility: "Visibilidad",
};

export const automation: AutomationCopy = {
  presetsDescription:
    "Selecciones de juegos guardadas con estado en línea y título de Steam. Un clic carga una y los horarios las usan automáticamente.",
  saveCurrent: "Guardar la selección actual",
  saveCurrentHint: "{games} · {persona}{title}",
  noTitle: " · sin título",
  withTitle: " · título «{title}»",
  runningNow: "En curso",
  activeButton: "Activo",
  gamesCount: "{count} juegos",
  gameCount: "1 juego",
  usedBySchedules: "en {count} horarios",
  usedBySchedule: "en 1 horario",
  morePresetGames: "+{count}",
  newPresetTitle: "Guardar como preajuste",
  newPresetDescription:
    "Guarda los juegos seleccionados ahora para impulsar, el estado en línea y el título de Steam.",
  cancel: "Cancelar",
  schedulesDescription:
    "Inicia un preajuste a horas fijas y vuelve a pausar después.",
  newSchedule: "Nuevo horario",
  timezone: "Zona horaria",
  thisWeek: "Esta semana",
  weekLabel: "Plan semanal de horarios activados y desactivados",
  offSuffix: "desactivado",
  nextStart: "próximo inicio {time}",
  noNextStart: "sin inicio en los próximos 7 días",
  skippedNext: "próximo inicio omitido",
  disabled: "desactivado",
  everyDay: "a diario",
  weekdaysShort: "lun–vie",
  presetNamed: "Preajuste «{name}»",
  toggleSchedule: "Activar o desactivar {name}",
  upcoming: "Próximas franjas",
  analyticsDescription:
    "Cuánto tiempo notificó SteamBee juegos para esta cuenta.",
  runningNowShort: "En curso",
  notRunning: "Nada ahora mismo",
  last7Days: "Últimos 7 días",
  perDay: "Ø {value} al día",
  totalSessions: "Sesiones",
  allTime: "en total",
  playtimePerDay: "Tiempo de juego por día",
  playtimePerDayLabel:
    "Tiempo de juego notificado por día en los últimos 7 días",
  todayShort: "Hoy",
  goalProgress: "{current} de {target} h",
  goalLeft: "faltan {hours} h",
  goalReached: "alcanzado",
};
