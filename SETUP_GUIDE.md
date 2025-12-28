# Guida Completa Setup Stripe + Firebase Functions

## ✅ Passo 1: Firebase CLI installato
Hai già installato `firebase-tools` globalmente. Ottimo!

**⚠️ IMPORTANTE**: Se il comando `firebase` non viene trovato, usa il percorso completo:
```bash
/Users/niccologatti/.npm-global/bin/firebase
```

Oppure aggiungi al PATH (vedi `FIX_FIREBASE_PATH.md` per dettagli):
```bash
export PATH="$HOME/.npm-global/bin:$PATH"
```

## 📋 Passo 2: Login a Firebase

Esegui nel terminale:
```bash
# Se hai aggiunto al PATH:
firebase login

# Oppure usa il percorso completo:
/Users/niccologatti/.npm-global/bin/firebase login
```

Questo aprirà il browser per autenticarti con il tuo account Google associato al progetto Firebase.

## 🔧 Passo 3: Installare dipendenze Functions

```bash
cd functions
npm install
cd ..
```

## 🔑 Passo 4: Ottenere le chiavi Stripe

1. Vai su https://dashboard.stripe.com/test/apikeys
2. Copia la **Secret key** (inizia con `sk_test_...`) - ⚠️ **Questa è l'unica che ti serve!**
3. La **Publishable key** (inizia con `pk_test_...`) **NON serve** nel nostro setup perché usiamo Firebase Functions

### 📍 Dove inserire la chiave:

**La Secret key va SOLO in Firebase Functions Config** (vedi passo 5). **NON va mai nel frontend!**

## ⚙️ Passo 5: Configurare Firebase Functions

Esegui questi comandi (sostituisci `sk_test_...` con la tua Secret key):

```bash
# Configura la secret key di Stripe (la chiave PRIVATA)
firebase functions:config:set stripe.secret_key="sk_test_TUA_CHIAVE_QUI"

# Configura il prezzo in centesimi (500 = €5.00)
firebase functions:config:set subscription.price="500"

# Per il webhook secret, lo configureremo dopo aver creato il webhook
```

**Esempio completo:**
```bash
firebase functions:config:set stripe.secret_key="sk_test_51AbCdEfGhIjKlMnOpQrStUvWxYz1234567890"
firebase functions:config:set subscription.price="500"
```

**⚠️ IMPORTANTE:** 
- La Secret key è **PRIVATA** e va **SOLO** in Firebase Functions Config
- **NON** metterla mai in `app.js`, HTML o altri file frontend
- Firebase Functions Config è sicuro e criptato

## 🚀 Passo 6: Deploy delle Functions

```bash
firebase deploy --only functions
```

**Nota**: Se è la prima volta, potrebbe richiedere alcuni minuti.

## 🔗 Passo 7: Configurare il Webhook Stripe

1. Vai su https://dashboard.stripe.com/test/webhooks
2. Clicca **Add endpoint**
3. **Endpoint URL**: 
   ```
   https://us-central1-study-planner-80c7a.cloudfunctions.net/handleStripeWebhook
   ```
   (Sostituisci `us-central1` con la tua regione se diversa)
4. Seleziona questi eventi:
   - `checkout.session.completed`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
   - `invoice.payment_succeeded`
   - `invoice.payment_failed`
5. Clicca **Add endpoint**
6. Copia il **Signing secret** (inizia con `whsec_...`)
7. Configuralo in Firebase:
   ```bash
   firebase functions:config:set stripe.webhook_secret="whsec_TUA_CHIAVE_QUI"
   ```
8. Rifa il deploy:
   ```bash
   firebase deploy --only functions
   ```

## 🧪 Passo 8: Testare il Pagamento

1. Vai sulla tua app e clicca "Passa a Premium"
2. Usa una carta di test Stripe:
   - **Numero**: `4242 4242 4242 4242`
   - **CVC**: qualsiasi 3 cifre (es. `123`)
   - **Data**: qualsiasi data futura (es. `12/25`)
   - **ZIP**: qualsiasi (es. `12345`)
3. Completa il pagamento
4. Verifica che l'abbonamento sia attivo nel profilo

## 📊 Passo 9: Verificare i Logs

Per vedere i logs delle functions:
```bash
firebase functions:log
```

## 🔍 Troubleshooting

### Errore: "Functions config not found"
```bash
# Verifica la configurazione
firebase functions:config:get
```

### Errore: "Permission denied"
Assicurati di essere loggato:
```bash
firebase login
```

### Webhook non funziona
1. Verifica che l'URL sia corretto
2. Controlla i logs: `firebase functions:log`
3. Verifica che il webhook secret sia configurato correttamente

## 🌐 Passaggio a Produzione

Quando sei pronto per andare in produzione:

1. **Stripe**:
   - Vai su https://dashboard.stripe.com/apikeys
   - Usa le chiavi **Live** (non test)
   - Crea un nuovo webhook per produzione

2. **Firebase**:
   ```bash
   firebase functions:config:set stripe.secret_key="sk_live_TUA_CHIAVE_LIVE"
   firebase functions:config:set stripe.webhook_secret="whsec_TUA_CHIAVE_LIVE"
   firebase deploy --only functions
   ```

3. **Aggiorna l'URL del webhook** in Stripe Dashboard con l'URL di produzione

## 📝 Note

- Le chiavi Stripe sono sensibili: non committarle mai su Git
- Usa sempre la modalità test prima di andare in produzione
- Monitora i logs per eventuali errori
- Il webhook è essenziale per aggiornare lo stato dell'abbonamento

## 🆘 Supporto

Se hai problemi:
1. Controlla i logs: `firebase functions:log`
2. Verifica la configurazione: `firebase functions:config:get`
3. Consulta la documentazione Stripe: https://stripe.com/docs

