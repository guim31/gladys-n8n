// -----------------------------------------------------------------------------
// Texts the integration sends to Gladys outside the widget (src/widgets.js):
// connection status, errors, execution states, the "Test the connection"
// report, scene outputs and errors, dates. Four languages, the four of the
// Gladys interface; German says "du", Spanish "usted". test/i18n.test.js
// checks every table.
// -----------------------------------------------------------------------------

import { ERROR_KINDS } from './n8n/client.js';

export const INIT_FAILED = {
  en: 'Initialization failed, check the integration logs.',
  fr: "L'initialisation a échoué, consultez les logs de l'intégration.",
  de: 'Initialisierung fehlgeschlagen, sieh dir die Protokolle der Integration an.',
  es: 'La inicialización ha fallado, consulte los registros de la integración.',
};

export const CONNECTION_TEXT = {
  noUrl: {
    en: 'Enter the address of your n8n in the configuration.',
    fr: "Saisissez l'adresse de votre n8n dans la configuration.",
    de: 'Gib die Adresse deines n8n in der Konfiguration ein.',
    es: 'Introduzca la dirección de su n8n en la configuración.',
  },
  invalidUrl: {
    en: 'Address not understood, e.g. http://192.168.1.2:5678',
    fr: 'Adresse incomprise, ex. http://192.168.1.2:5678',
    de: 'Adresse nicht verstanden, z. B. http://192.168.1.2:5678',
    es: 'Dirección no válida, p. ej. http://192.168.1.2:5678',
  },
  noKey: {
    en: 'Paste an n8n API key in the configuration (Settings → n8n API).',
    fr: "Collez une clé d'API n8n dans la configuration (Settings → n8n API).",
    de: 'Füge einen n8n-API-Schlüssel in der Konfiguration ein (Settings → n8n API).',
    es: 'Pegue una clave de API de n8n en la configuración (Settings → n8n API).',
  },
};

// One short explanation per error kind (src/n8n/client.js).
export const ERROR_TEXT = {
  [ERROR_KINDS.UNREACHABLE]: {
    en: 'n8n does not answer',
    fr: 'n8n ne répond pas',
    de: 'n8n antwortet nicht',
    es: 'n8n no responde',
  },
  [ERROR_KINDS.TIMEOUT]: {
    en: 'n8n did not answer in time',
    fr: "n8n n'a pas répondu à temps",
    de: 'n8n hat nicht rechtzeitig geantwortet',
    es: 'n8n no ha respondido a tiempo',
  },
  [ERROR_KINDS.TLS]: {
    en: 'certificate refused: use an http:// address or a trusted certificate',
    fr: 'certificat refusé : utilisez une adresse http:// ou un certificat reconnu',
    de: 'Zertifikat abgelehnt: Nutze eine http://-Adresse oder ein vertrauenswürdiges Zertifikat',
    es: 'certificado rechazado: use una dirección http:// o un certificado reconocido',
  },
  [ERROR_KINDS.AUTH]: {
    en: 'API key refused: create a new one in Settings → n8n API',
    fr: "clé d'API refusée : créez-en une nouvelle dans Settings → n8n API",
    de: 'API-Schlüssel abgelehnt: Erstelle einen neuen unter Settings → n8n API',
    es: 'clave de API rechazada: cree una nueva en Settings → n8n API',
  },
  [ERROR_KINDS.SCOPE]: {
    en: 'refused by n8n: the API key lacks a scope, or the workflow is not yours',
    fr: "refusé par n8n : il manque un droit à la clé d'API, ou le workflow ne vous appartient pas",
    de: 'von n8n abgelehnt: Dem API-Schlüssel fehlt ein Recht, oder der Workflow gehört dir nicht',
    es: 'rechazado por n8n: a la clave de API le falta un permiso, o el workflow no es suyo',
  },
  [ERROR_KINDS.NOT_N8N]: {
    en: 'no n8n API at this address (or the public API is disabled)',
    fr: "aucune API n8n à cette adresse (ou l'API publique est désactivée)",
    de: 'keine n8n-API unter dieser Adresse (oder die öffentliche API ist deaktiviert)',
    es: 'no hay ninguna API de n8n en esta dirección (o la API pública está desactivada)',
  },
  [ERROR_KINDS.REDIRECT]: {
    en: 'the address redirects: enter the https:// address',
    fr: "l'adresse redirige : saisissez l'adresse en https://",
    de: 'die Adresse leitet um: Gib die https://-Adresse ein',
    es: 'la dirección redirige: introduzca la dirección https://',
  },
  [ERROR_KINDS.NOT_FOUND]: {
    en: 'this workflow no longer exists in n8n',
    fr: "ce workflow n'existe plus dans n8n",
    de: 'dieser Workflow existiert in n8n nicht mehr',
    es: 'este workflow ya no existe en n8n',
  },
  [ERROR_KINDS.REFUSED]: {
    en: 'refused by n8n',
    fr: 'refusé par n8n',
    de: 'von n8n abgelehnt',
    es: 'rechazado por n8n',
  },
  [ERROR_KINDS.HTTP]: {
    en: 'unexpected answer, see the logs',
    fr: 'réponse inattendue, voir les logs',
    de: 'unerwartete Antwort, sieh in den Protokollen nach',
    es: 'respuesta inesperada, consulte los registros',
  },
};

// The state of a workflow, in words: its last execution, or running now.
export const STATE_TEXT = {
  success: { en: 'Succeeded', fr: 'Réussi', de: 'Erfolgreich', es: 'Correcto' },
  error: { en: 'Failed', fr: 'En échec', de: 'Fehlgeschlagen', es: 'Fallido' },
  crashed: { en: 'Crashed', fr: 'Planté', de: 'Abgestürzt', es: 'Bloqueado' },
  canceled: { en: 'Canceled', fr: 'Annulé', de: 'Abgebrochen', es: 'Cancelado' },
  running: { en: 'Running', fr: 'En cours', de: 'Läuft', es: 'En ejecución' },
  waiting: { en: 'Waiting', fr: 'En attente', de: 'Wartet', es: 'En espera' },
  new: { en: 'Starting', fr: 'Démarrage', de: 'Startet', es: 'Iniciando' },
  never: { en: 'Never run', fr: 'Jamais exécuté', de: 'Nie ausgeführt', es: 'Nunca ejecutado' },
};

export const ACTIVE_TEXT = {
  true: { en: 'active', fr: 'actif', de: 'aktiv', es: 'activo' },
  false: { en: 'inactive', fr: 'inactif', de: 'inaktiv', es: 'inactivo' },
};

// The "Test the connection" report.
export const REPORT_TEXT = {
  en: {
    ok: 'Connected',
    workflows: (count) => `${count} workflow(s)`,
    active: (count) => `${count} active`,
    failures: (count) => `${count} failure(s) in 24 h`,
  },
  fr: {
    ok: 'Connecté',
    workflows: (count) => `${count} workflow(s)`,
    active: (count) => `${count} actif(s)`,
    failures: (count) => `${count} échec(s) en 24 h`,
  },
  de: {
    ok: 'Verbunden',
    workflows: (count) => `${count} Workflow(s)`,
    active: (count) => `${count} aktiv`,
    failures: (count) => `${count} Fehlschlag/Fehlschläge in 24 h`,
  },
  es: {
    ok: 'Conectado',
    workflows: (count) => `${count} workflow(s)`,
    active: (count) => `${count} activo(s)`,
    failures: (count) => `${count} fallo(s) en 24 h`,
  },
};

// Errors and results of the scene actions and of the switch (shown in Gladys).
export const ACTION_TEXT = {
  unknownWorkflow: {
    en: 'This device is not an n8n workflow.',
    fr: "Cet appareil n'est pas un workflow n8n.",
    de: 'Dieses Gerät ist kein n8n-Workflow.',
    es: 'Este dispositivo no es un workflow de n8n.',
  },
  readOnly: {
    en: 'Switching workflows from Gladys is off: enable it in the configuration.',
    fr: 'Activer un workflow depuis Gladys est désactivé : autorisez-le dans la configuration.',
    de: 'Workflows aus Gladys schalten ist aus: Erlaube es in der Konfiguration.',
    es: 'Activar workflows desde Gladys está desactivado: permítalo en la configuración.',
  },
  badPath: {
    en: 'Webhook path not understood: the path of the Webhook node, or its Production URL.',
    fr: 'Chemin de webhook incompris : le chemin du nœud Webhook, ou son URL de production.',
    de: 'Webhook-Pfad nicht verstanden: der Pfad des Webhook-Knotens oder seine Production URL.',
    es: 'Ruta de webhook no válida: la ruta del nodo Webhook, o su URL de producción.',
  },
};

// The `sentence` output of "State of a workflow".
export const SENTENCE_TEXT = {
  en: {
    lastRun: (time) => `last run ${time}`,
    never: 'never run',
    failures: (count) => `${count} failure(s) in 24 h`,
  },
  fr: {
    lastRun: (time) => `dernière exécution ${time}`,
    never: 'jamais exécuté',
    failures: (count) => `${count} échec(s) en 24 h`,
  },
  de: {
    lastRun: (time) => `letzter Lauf ${time}`,
    never: 'nie ausgeführt',
    failures: (count) => `${count} Fehlschlag/Fehlschläge in 24 h`,
  },
  es: {
    lastRun: (time) => `última ejecución ${time}`,
    never: 'nunca ejecutado',
    failures: (count) => `${count} fallo(s) en 24 h`,
  },
};

export const LANGUAGE_FALLBACK = 'en';

const LOCALES = { en: 'en-GB', fr: 'fr-FR', de: 'de-DE', es: 'es-ES' };
const formats = new Map();

/**
 * A date as day/month hours:minutes, in the time zone of Gladys (the
 * supervisor injects TZ): a weekly workflow run six days ago is not "today".
 */
export function formatTime(time, language) {
  const locale = LOCALES[language] ?? LOCALES.en;
  if (!formats.has(locale)) {
    formats.set(
      locale,
      new Intl.DateTimeFormat(locale, {
        day: '2-digit',
        month: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
      }),
    );
  }
  return formats.get(locale).format(new Date(time));
}

/** "Name: text", with the space French puts before a colon. */
export const labelled = (name, text, language) =>
  `${name}${language === 'fr' ? ' : ' : ': '}${text}`;
export const pick = (text, language) => text[language] ?? text[LANGUAGE_FALLBACK];
