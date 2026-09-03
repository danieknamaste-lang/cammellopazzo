# Policy BTC ciclica

Specifica operativa per l'esposizione in opzioni a una possibile nuova espansione
ciclica di Bitcoin. Implementata in [`lib/btc-cycle.js`](../lib/btc-cycle.js),
verificata da [`test/btc-cycle.js`](../test/btc-cycle.js).

> ⚠️ **La specifica da cui deriva questo modulo è incompleta.** Il testo ricevuto
> comincia a metà frase nella sezione 8 e non contiene le sezioni 1-8. Le lacune
> sono elencate in fondo. Il codice **non le colma per conto proprio**: dove manca
> una definizione si rifiuta di rispondere invece di indovinare.

## Principio guida

> L'obiettivo **non** è massimizzare la leva. È ottenere l'esposizione convessa di
> qualità più alta a una possibile nuova espansione ciclica di Bitcoin, mantenendo
> il ribasso predefinito.
>
> Non confondere mai **leva alta** con **valore atteso alto**.

## Soglie

| Soglia | Valore | Significato |
| ------ | ------ | ----------- |
| Trigger | chiusura settimanale **> 84.000** | autorizza l'**ANALISI** |
| Conferma | **98.000** | conferma |
| Warning | **62.300** | tesi in allarme |
| Invalidazione | **57.800** | tesi invalidata |

**Il trigger degli 84k non autorizza l'esecuzione.** Nel codice sono due campi
distinti (`authorizesAnalysis` / `authorizesExecution`), e il secondo è
costantemente `false`: l'ingresso richiede una decisione a parte.

## Stati

| Stato | Nome | Definito nella specifica ricevuta |
| ----- | ---- | --------------------------------- |
| 1 · 2 · 3 | — | ❌ **no** — citati, mai definiti |
| 4 | POSITION ACTIVE | ✅ |
| 5 | THESIS WARNING | ✅ |
| 6 | THESIS INVALIDATED | ✅ |

`classify()` restituisce `state: null` e la ragione esplicita quando ricadrebbe
negli stati 1-3, cioè quando non c'è posizione aperta e nessuna soglia di allarme
è violata. L'invalidazione ha precedenza sul warning.

## 9 · Dimensionamento

Il rischio si definisce in termini di portafoglio. `sizing()` calcola:

- premio massimo a rischio
- perdita massima di portafoglio (assoluta e in %)
- esposizione delta equivalente in BTC
- esposizione notional
- leva effettiva

**La leva va sempre riportata in entrambe le forme** — descriverla col solo
notional dell'opzione è vietato:

```
EFFECTIVE LEVERAGE: notional 0.17x · delta-adjusted 0.06x
```

Vincoli applicati da `guards()`:

- una posizione **long** su opzioni deve avere una perdita massima esplicitamente
  definita, altrimenti è una violazione di policy;
- l'esposizione **short nuda** è rifiutata salvo autorizzazione separata ed
  esplicita (`nakedShortAuthorized: true`).

## 10 · Gestione delle uscite

Le uscite si valutano su sette criteri, tutti da considerare:

| | Criterio |
|-|----------|
| A | deterioramento della tesi ciclica |
| B | invalidazione di prezzo |
| C | delta dell'opzione diventato eccessivamente alto |
| D | DTE residui |
| E | espansione della IV |
| F | raggiungimento del target BTC atteso |
| G | deterioramento del rapporto rischio/rendimento |

**Non tenere un'opzione meccanicamente fino a scadenza.** Se BTC apprezza
rapidamente e la long call va profondamente ITM, vanno confrontate cinque
alternative: mantenere, *roll up*, *roll forward*, conversione in spread, presa di
profitto parziale.

## 11 · Formato del report

`renderReport()` emette l'intestazione obbligatoria nell'ordine imposto (BTC
PRICE, WEEKLY CLOSE, CYCLICAL STATE, e i quattro gate), poi l'azione consigliata
fra `NO TRADE / WATCH / ENTER / REDUCE / EXIT / ROLL`, la struttura completa con
greche e leva, i tre scenari, e infine la sezione obbligatoria:

> **WHAT WOULD PROVE THIS TRADE WRONG?**

Un report privo di quella sezione è marcato `valid: false`.

### Niente numeri inventati

Ogni campo non fornito esce come `n/d` e finisce nell'elenco `DATI MANCANTI`, mai
stimato. È coerente col prompt che l'agente già invia al sistema multiagentico
(«se mancano dati di mercato, dillo esplicitamente invece di inventarli») ed è la
ragione per cui `valid` è `false` finché l'input non è completo. Il modulo calcola
e formatta: **non è una fonte di dati di mercato e non produce raccomandazioni.**

## Cosa manca ancora

Per completare l'implementazione servono le sezioni 1-8, in particolare:

1. **definizione degli stati 1, 2 e 3** e le transizioni fra loro — oggi il
   modulo si ferma e lo dichiara;
2. la **derivazione delle quattro soglie** (84k / 98k / 62.3k / 57.8k): sono
   applicate come costanti, ma il testo ricevuto non dice da dove vengono né se
   vanno ricalcolate nel tempo;
3. l'**universo dei sottostanti** ammessi (`BEST UNDERLYING` oggi è un campo
   libero: ETF spot, futures, opzioni su exchange cripto?);
4. i criteri di «**acceptable option pricing**» e «**constructive retracement**»
   della frase troncata in apertura;
5. le **fonti dati** per prezzo, chiusura settimanale, catena opzioni e IV.
