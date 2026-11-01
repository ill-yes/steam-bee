import type { AutomationCopy } from "../automationCopy";
import type { HubCopy } from "../hubCopy";

export const hub: HubCopy = {
  workspace: "Espace du compte",
  library: "Booster le temps de jeu",
  farming: "Farm de cartes",
  offers: "Gratuits à garder",
  account: "Compte et sécurité",
  activeGames: "Signalés à Steam actuellement",
  activeGamesShort: "Jeux actifs",
  activeGamesScroll:
    "Jeux actifs ; faites défiler horizontalement pour en voir plus",
  noActiveGames: "Aucun jeu n’est signalé à Steam pour le moment.",
  logsShort: "Journaux",
  stopShort: "Déconnecter",
  disconnect: "Se déconnecter de Steam",
  activityBoosting: "Boost du temps de jeu",
  activityFarming: "Farm de cartes",
  activityOnline: "En ligne, sans jeu",
  switchConfirm: "Changer de mode",
  confirmSwitch:
    "Arrêter le farm de cartes et reprendre le temps de jeu pour votre sélection manuelle enregistrée ? Le farm ne redémarrera pas automatiquement.",
  switchApply:
    "Le farm de cartes est actif. Appliquer cette sélection manuelle arrête le farm et passe ce compte en temps de jeu manuel. Continuer ?",
  switchSettings:
    "Le farm de cartes est actif. Modifier ces paramètres du compte arrête le farm et rétablit la sélection manuelle enregistrée. Continuer ?",
  switchPreset:
    "Le farm de cartes est actif. Appliquer ce préréglage arrête le farm et passe ce compte à la sélection manuelle du préréglage. Continuer ?",
  farmingSelectionHint:
    "Le farm de cartes est actif. Voici votre sélection manuelle enregistrée. L’appliquer arrête le farm ; changer d’onglet ne modifie pas l’activité en cours.",
  savedSelection: "Jeux manuels enregistrés",
  savedSelectionHint:
    "Enregistrés pour le temps de jeu manuel ; le farm utilise les jeux affichés ci-dessus.",
  farmingStatusHint:
    "Le farm de cartes contrôle les jeux actifs affichés ci-dessus. Votre sélection manuelle reste disponible dans Booster le temps de jeu.",
  navLabel: "Sections du compte",
  navActivity: "Jeux",
  navItems: "Objets",
  navDiscover: "Découvrir",
  navAccount: "Compte",
  inventoryNav: "Inventaire",
  listings: "Offres sur le marché",
  rules: "Règles de prix",
  dropsCount: "{count} drops à récupérer",
  modeLabel: "Activité signalée à Steam",
  modeNone: "Rien",
  modeNoneOnline: "En ligne, sans jeu",
  modeNoneOffline: "Non connecté",
  modeBoost: "Booster le temps de jeu",
  modeBoostGames: "{count} jeux sur {limit}",
  modeBoostEmpty: "Choisissez d’abord des jeux",
  modeFarm: "Farmer des cartes",
  modeFarmDrops: "{drops} drops dans {games} jeux",
  modeFarmNoDrops: "Aucun drop de carte trouvé",
  modeFarmUnknown: "Drops de cartes pas encore vérifiés",
  modeFarmUnavailable: "Ouvrez le farm de cartes pour vérifier les drops",
  modeExplain:
    "Steam garde une seule liste de jeux en cours par compte, donc un seul mode fonctionne à la fois. La sélection de l’autre mode reste enregistrée.",
  confirmFarming:
    "Passer au farm de cartes ? Le temps de jeu de vos {count} jeux sélectionnés s’arrête ; la sélection reste enregistrée. Quand tous les drops sont récupérés, le compte se met en pause.",
  confirmFarmingIdle:
    "Démarrer le farm de cartes ? Quand tous les drops sont récupérés, le compte se met en pause.",
  farmingConfirm: "Démarrer le farm",
  confirmIdle:
    "Arrêter de signaler des jeux à Steam ? Le compte reste connecté et en pause ; vos sélections restent enregistrées.",
  idleConfirm: "Mettre en pause",
  reloginTitle: "Se reconnecter : {name}",
  reloginDescription:
    "Connectez-vous avec le même compte Steam. Vos sélections, préréglages et paramètres restent enregistrés.",
  reloginBannerTitle: "Steam a mis fin à la connexion",
  reloginBannerText:
    "Cela arrive après un changement de mot de passe ou quand la session expire. Reconnectez-vous une fois, puis le boost, le farm et l’inventaire fonctionnent comme avant. Vos sélections restent enregistrées.",
  reloginQr: "Se reconnecter (code QR)",
  reloginPassword: "Avec mot de passe",
  steamMessage: "Steam indique : {message}",
  navAutomation: "Automatisation",
  sectionSelect: "Rubrique",
  presets: "Préréglages",
  schedules: "Plannings",
  analytics: "Statistiques",
  inventoryDescription:
    "Vos objets Steam regroupés par jeu et par set de badge. Choisissez des doublons pour le panier de vente.",
  listingsDescription:
    "Les objets que vous proposez actuellement sur le marché de la communauté Steam.",
  rulesDescription: "Comment SteamBee calcule le prix quand vous vendez.",
  accountDescription:
    "Profil Steam, limites de temps de jeu et état de connexion de ce compte.",
  stateTitle: "État",
  steamProfile: "Profil Steam",
  dangerTitle: "Supprimer le compte",
  dangerText:
    "Supprime la connexion et les paramètres de ce compte dans SteamBee.",
  lastEvent: "Dernier événement",
  noEvents: "Aucun événement pour l’instant",
  activeGamesState: "Jeux actifs",
  boostingSince: "Boost depuis",
  visibility: "Visibilité",
};

export const automation: AutomationCopy = {
  presetsDescription:
    "Sélections de jeux enregistrées avec statut en ligne et titre Steam. Un clic en charge une, et les plannings les utilisent automatiquement.",
  saveCurrent: "Enregistrer la sélection actuelle",
  saveCurrentHint: "{games} · {persona}{title}",
  noTitle: " · sans titre",
  withTitle: " · titre « {title} »",
  runningNow: "En cours",
  activeButton: "Actif",
  gamesCount: "{count} jeux",
  gameCount: "1 jeu",
  usedBySchedules: "dans {count} plannings",
  usedBySchedule: "dans 1 planning",
  morePresetGames: "+{count}",
  newPresetTitle: "Enregistrer comme préréglage",
  newPresetDescription:
    "Enregistre les jeux actuellement sélectionnés pour le boost, le statut en ligne et le titre Steam.",
  cancel: "Annuler",
  schedulesDescription:
    "Démarre un préréglage à heures fixes puis remet en pause ensuite.",
  newSchedule: "Nouveau planning",
  timezone: "Fuseau horaire",
  thisWeek: "Cette semaine",
  weekLabel: "Plan hebdomadaire des plannings activés et désactivés",
  offSuffix: "désactivé",
  nextStart: "prochain départ {time}",
  noNextStart: "aucun départ dans les 7 prochains jours",
  skippedNext: "prochain départ ignoré",
  disabled: "désactivé",
  everyDay: "tous les jours",
  weekdaysShort: "lun–ven",
  presetNamed: "Préréglage « {name} »",
  toggleSchedule: "Activer ou désactiver {name}",
  upcoming: "Prochaines plages",
  analyticsDescription:
    "Combien de temps SteamBee a signalé des jeux pour ce compte.",
  runningNowShort: "En cours",
  notRunning: "Rien en ce moment",
  last7Days: "7 derniers jours",
  perDay: "Ø {value} par jour",
  totalSessions: "Nombre de sessions",
  allTime: "au total",
  playtimePerDay: "Temps de jeu par jour",
  playtimePerDayLabel: "Temps de jeu signalé par jour sur les 7 derniers jours",
  todayShort: "Auj.",
  goalProgress: "{current} sur {target} h",
  goalLeft: "encore {hours} h",
  goalReached: "atteint",
};
