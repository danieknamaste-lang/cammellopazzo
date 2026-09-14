# Proxy GLM-5.3 per Claude Code (always-on sul mini)

Fa girare **GLM-5.3 dentro Claude Code** usando le chiavi **Nous Research**, che
costano molto meno. Claude Code resta identico — tools, agent, MCP, interfaccia —
ma a ragionare è GLM.

```
Claude Code  --(formato Anthropic)-->  LiteLLM  --(formato OpenAI)-->  Nous  -->  GLM-5.3
             ANTHROPIC_BASE_URL          :4000      inference-api.nousresearch.com
```

Il modello **non gira in locale**: il proxy è solo un traduttore HTTP.
Consuma ~200 MB di RAM e ~0% di CPU a riposo, nessuna GPU.

## Installazione sul mini

```bash
git pull
cd tools/glm-proxy
./install.sh
```

L'installer fa tutto: installa LiteLLM se manca, chiede la chiave Nous, rileva
gli ID reali dei modelli GLM dal catalogo Nous, genera la configurazione,
registra il servizio `launchd` (parte da solo al boot, si riavvia se cade) e
alla fine **esegue il test end-to-end** con una vera chiamata a GLM-5.3.

È **idempotente**: rieseguirlo aggiorna la config ma conserva la master key
esistente, così gli alias sui client non vanno rifatti.

Non interattivo: `NOUS_API_KEY=xxx ./install.sh`

## Configurazione dei client

A fine installazione lo script stampa gli alias già pronti, con l'IP LAN del
mini rilevato automaticamente. In sintesi, in `~/.zshrc`:

```bash
export LITELLM_MASTER_KEY="sk-glm-..."   # la stampa install.sh

claude-glm() {
  env ANTHROPIC_BASE_URL="http://IP-DEL-MINI:4000" \
      ANTHROPIC_AUTH_TOKEN="$LITELLM_MASTER_KEY" \
      ANTHROPIC_DEFAULT_OPUS_MODEL="glm-5.3" \
      ANTHROPIC_DEFAULT_SONNET_MODEL="glm-5.3" \
      ANTHROPIC_DEFAULT_HAIKU_MODEL="glm-5.3-flash" \
      claude "$@"
}
```

Dal mini stesso si usa `127.0.0.1` al posto dell'IP.

**Perché il mapping dei tier:** Claude Code usa il tier *haiku* per le operazioni
interne frequenti (titoli, riassunti). Mandarle su `glm-5.3-flash` invece che sul
modello grande abbatte la spesa senza toccare la qualità del ragionamento, che
resta su `glm-5.3` (tier opus/sonnet).

## Comandi

| Cosa | Comando |
| --- | --- |
| Testare | `~/.glm-proxy/healthcheck.sh` |
| Testare dal portatile | `~/.glm-proxy/healthcheck.sh IP-DEL-MINI` |
| Log | `tail -f ~/.glm-proxy/logs/litellm.err.log` |
| Riavviare | `launchctl kickstart -k gui/$(id -u)/com.glm.litellm` |
| Disinstallare | `./uninstall.sh` (aggiungi `--purge` per togliere anche le chiavi) |

## Due trappole, già risolte qui

Sono state trovate testando LiteLLM 1.100.1 contro un backend simulato. Se un
giorno rifai la configurazione a mano, sono i due punti su cui si sbatte.

**1. `/v1/messages` finisce sul Responses API invece che su chat/completions.**
In LiteLLM `_RESPONSES_API_PROVIDERS = {"openai"}`: ogni modello con prefisso
`openai/` viene instradato su `/v1/responses`, che Nous non espone. La richiesta
parte con `input`/`instructions`/`max_output_tokens` invece di
`messages`/`max_tokens` e **fallisce sempre**. Si corregge con:

```bash
LITELLM_USE_CHAT_COMPLETIONS_URL_FOR_ANTHROPIC_MESSAGES=True
```

Attenzione: LiteLLM la legge con `bool(os.getenv(...))`, quindi *qualsiasi*
valore non vuoto la attiva — anche la stringa `"False"`. Per disattivarla va
svuotata, non messa a `False`.

**2. `additional_drop_params` va per modello, non globale.**
In `litellm_settings` viene ignorato su `/v1/messages` (bug LiteLLM #25931).
Va messo dentro `litellm_params` del singolo modello, come nel template.

Serve perché Claude Code invia `metadata.user_id`, che LiteLLM traduce in
`prompt_cache_key`: un parametro che i gateway di terze parti possono rifiutare
con 400. Scartarlo non disabilita il prompt caching, che passa da `cache_control`.

## File

| File | Ruolo |
| --- | --- |
| `install.sh` | installa, configura e verifica |
| `uninstall.sh` | rimuove il servizio |
| `healthcheck.sh` | test end-to-end (launchd, porta, auth, inferenza reale) |
| `run.sh` | wrapper eseguito da launchd |
| `config.yaml.template` | config LiteLLM (i segnaposto li espande install.sh) |
| `com.glm.litellm.plist.template` | definizione del servizio launchd |

A runtime tutto vive in `~/.glm-proxy/`. Le chiavi stanno in `~/.glm-proxy/env`
con permessi `600` — **non è nel repo e non va committato**.

## Sicurezza

Il proxy ascolta su `0.0.0.0:4000` per essere raggiungibile dal portatile in LAN,
protetto dalla master key. **Non aprire la porta 4000 sul router**: chiunque da
Internet potrebbe consumare il vostro credito Nous.
