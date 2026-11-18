import { getJsonSetting, setJsonSetting } from './db.js';

/**
 * Incident "connu" sur un tracker : signal manuel de l'utilisateur pour dire
 * "ce site a un souci côté admin, c'est pas mes credentials".
 * - Le refresh continue normalement -> retour à OK = clear auto
 * - Sur le frontend, change le badge "Erreur" rouge en "Incident connu" neutre
 */
export interface TrackerIncident {
  acknowledged: boolean;
  note: string;
  updatedAt: string;
}

export type IncidentsMap = Record<string, TrackerIncident>;

export function loadIncidents(): IncidentsMap {
  const raw = getJsonSetting('tracker_incidents', {} as IncidentsMap);
  return raw && typeof raw === 'object' ? raw : {};
}

export function saveIncidents(incidents: IncidentsMap): void {
  setJsonSetting('tracker_incidents', incidents);
}

export function getIncident(trackerId: string): TrackerIncident | null {
  const incidents = loadIncidents();
  return incidents[trackerId] ?? null;
}

export function setIncident(trackerId: string, acknowledged: boolean, note: string): TrackerIncident {
  const incidents = loadIncidents();
  const incident: TrackerIncident = {
    acknowledged,
    note: (note ?? '').trim().slice(0, 500),
    updatedAt: new Date().toISOString(),
  };
  if (!acknowledged && !incident.note) {
    // Pas d'ack et pas de note -> on supprime carrément l'entrée
    delete incidents[trackerId];
  } else {
    incidents[trackerId] = incident;
  }
  saveIncidents(incidents);
  return incident;
}

export function clearIncident(trackerId: string): void {
  const incidents = loadIncidents();
  if (incidents[trackerId]) {
    delete incidents[trackerId];
    saveIncidents(incidents);
  }
}
