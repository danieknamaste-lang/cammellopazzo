# Agente Opzioni — app Android

Stessa interfaccia dell'app Umbrel, ma **senza server in mezzo**: l'agente gira dentro il telefono
e parla direttamente con il sistema multiagentico sul mac.

```
   Pixel (GrapheneOS)                         Mac mini
  ┌────────────────────────┐                ┌──────────────────────────┐
  │ Agente Opzioni (APK)   │   Tailscale    │ sistema multiagentico    │
  │ • regole NL → query    │ ─────────────► │ di opzioni               │
  │ • connettore diretto   │ ◄───────────── │ quant · risk · macro · … │
  │ • storico sul telefono │  100.x.y.z     └──────────────────────────┘
  └────────────────────────┘
```

Serve perché Umbrel e il mac stanno su due reti che non si parlano, mentre il telefono è già nella
tailnet del mac.

## Installazione

1. Scarica l'APK dall'ultima release: **[Releases](https://github.com/danieknamaste-lang/cammellopazzo/releases)**
   → file `agente-opzioni-debug.apk`
2. Aprilo dal telefono e consenti l'installazione da questa sorgente (su GrapheneOS: *Installa app
   sconosciute* per il browser o il file manager che stai usando).
3. Assicurati che **Tailscale sia attivo** sul telefono e che il mac sia nella stessa tailnet.

L'APK è firmato con la chiave di debug: va bene per uso personale via sideload, non per il Play Store.

## Primo avvio

⚙ in alto a destra → **Endpoint** → l'indirizzo del mac nella tailnet, per esempio:

```
http://100.101.102.103:8000
```

Usa l'**indirizzo numerico 100.x** (lo leggi nell'app Tailscale accanto al nome del mac): i nomi
MagicDNS non sempre risolvono dentro la WebView. Poi *Salva* → *Prova collegamento*: se il pallino
diventa verde ci siamo.

## Come parla col mac

Le richieste partono dal livello nativo di Android (plugin `CapacitorHttp`), non dalla WebView:
questo evita i problemi di CORS, quindi **il sistema sul mac non deve essere configurato in alcun
modo**. Il rovescio della medaglia: la risposta arriva tutta insieme invece che parola per parola.
Se il sistema sul mac espone gli header CORS, lo streaming torna a funzionare.

Il traffico in chiaro (`http://`) verso la tailnet è consentito di proposito: dentro Tailscale la
connessione è già cifrata end-to-end.

## Cosa cambia rispetto alla versione Umbrel

| | Umbrel | Android |
| --- | --- | --- |
| Dove gira l'agente | container sul server | dentro il telefono |
| Pianificatore | regole, o Claude/DeepSeek/Ollama se configurati | solo regole (nessuna chiave API sul telefono) |
| Storico e preset | file in `/data`, condivisi fra dispositivi | memoria del telefono |
| Endpoint | raggiungibile da Umbrel | raggiungibile dal telefono via Tailscale |

Schema della query e regole di estrazione sono **gli stessi file** (`options-agent/lib/schema.js` e
`rules.js`), copiati nel pacchetto dal build: una sola fonte di verità.

## Compilare in locale

```bash
cd android-opzioni
npm install
npm run apk      # richiede Android SDK e Java 21
```

Oppure lascia fare a GitHub Actions: il workflow `opzioni-apk.yml` costruisce l'APK a ogni push e lo
pubblica come release.
