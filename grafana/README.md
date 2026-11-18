# Prometheus + Grafana

## 1. Exposer les métriques

L'endpoint `/metrics` est protégé par token. Ajoute la variable d'environnement `METRICS_TOKEN` au container :

```yaml
services:
  tracker-dashboard:
    image: ghcr.io/tracker-dashboard/tracker-dashboard:latest
    environment:
      METRICS_TOKEN: change-moi-en-un-truc-long-et-aleatoire
    ports:
      - "3000:3000"
    volumes:
      - ./config:/app/config
```

Si `METRICS_TOKEN` n'est pas défini, l'endpoint renvoie 503 (sécurité par défaut).

## 2. Scraper depuis Prometheus

Dans `prometheus.yml` :

```yaml
scrape_configs:
  - job_name: tracker-dashboard
    metrics_path: /metrics
    scheme: http
    static_configs:
      - targets: ['tracker-dashboard:3000']
    authorization:
      type: Bearer
      credentials: change-moi-en-un-truc-long-et-aleatoire
```

L'intervalle de scrape par défaut de Prometheus (15s) est largement suffisant — les stats du dashboard sont rafraîchies toutes les ~15 minutes côté tracker, donc Prometheus va voir les mêmes valeurs pendant plusieurs scrapes (c'est normal).

## 3. Importer le dashboard Grafana

1. Ajouter Prometheus comme datasource dans Grafana
2. `+` -> `Import` -> coller le contenu de `dashboard.json` -> sélectionner la datasource Prometheus

Le dashboard utilise une variable `$tracker` (multi-select) — par défaut tous les trackers sont sélectionnés.

## Métriques exposées

| Métrique | Type | Description |
|---|---|---|
| `tracker_uploaded_bytes_total` | counter | Octets envoyés (cumulatif) |
| `tracker_downloaded_bytes_total` | counter | Octets telecharges (cumulatif) |
| `tracker_ratio` | gauge | Ratio (scrape ou calculé up/down) |
| `tracker_buffer_bytes` | gauge | Buffer (scrape ou up - down) |
| `tracker_seed_bonus` | gauge | Bonus |
| `tracker_seeding_count` | gauge | Seeds actifs |
| `tracker_leeching_count` | gauge | Leech actifs |
| `tracker_points` | gauge | Points (trackers ratioless) |
| `tracker_rate_per_day` | gauge | Pts/jour (ratioless) |
| `tracker_tokens` | gauge | Tokens freeleech |
| `tracker_up` | gauge | 1 = OK, 0 = erreur |
| `tracker_site_reachable` | gauge | 1 = joignable, 0 = HS |
| `tracker_last_update_timestamp_seconds` | gauge | Timestamp du dernier refresh |

Tous les métriques portent deux labels :
- `tracker` (id technique, ex: `hdonly`)
- `name` (nom affiche, ex: `HD-Only`)
