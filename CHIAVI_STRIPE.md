# Dove Inserire le Chiavi Stripe

## 🔑 Chiavi da Stripe Dashboard

Quando vai su https://dashboard.stripe.com/test/apikeys trovi:

1. **Publishable key** (inizia con `pk_test_...`) - Chiave PUBBLICA
2. **Secret key** (inizia con `sk_test_...`) - Chiave PRIVATA ⚠️

## 📍 Dove Inserire le Chiavi

### ✅ Chiave PRIVATA (Secret key) → Firebase Functions Config

**NON va mai nel frontend!** Va solo nel backend (Firebase Functions).

Esegui nel terminale:
```bash
firebase functions:config:set stripe.secret_key="sk_test_TUA_CHIAVE_PRIVATA_QUI"
```

**Esempio:**
```bash
firebase functions:config:set stripe.secret_key="sk_test_51AbCdEfGhIjKlMnOpQrStUvWxYz1234567890"
```

### ❌ Chiave PUBBLICA (Publishable key) → NON NECESSARIA

Nel nostro setup, **NON usiamo la chiave pubblica** perché:
- Usiamo Firebase Functions per creare la sessione Stripe (backend)
- Il frontend chiama solo Firebase Functions, non Stripe direttamente
- Stripe Checkout gestisce tutto lato Stripe

**Quindi puoi ignorare la Publishable key per ora.**

## 🔐 Webhook Secret

Dopo aver creato il webhook in Stripe Dashboard, otterrai anche un **Webhook Secret** (inizia con `whsec_...`).

Anche questo va in Firebase Functions Config:
```bash
firebase functions:config:set stripe.webhook_secret="whsec_TUA_CHIAVE_WEBHOOK_QUI"
```

## 📝 Riepilogo Comandi

```bash
# 1. Configura la chiave privata Stripe
firebase functions:config:set stripe.secret_key="sk_test_..."

# 2. Configura il prezzo (in centesimi: 500 = €5.00)
firebase functions:config:set subscription.price="500"

# 3. Dopo aver creato il webhook, configura il webhook secret
firebase functions:config:set stripe.webhook_secret="whsec_..."

# 4. Verifica la configurazione
firebase functions:config:get

# 5. Deploy delle functions
firebase deploy --only functions
```

## ⚠️ IMPORTANTE: Sicurezza

- ❌ **NON** committare mai le chiavi su Git
- ❌ **NON** mettere la Secret key nel frontend (app.js, HTML, etc.)
- ✅ Le chiavi vanno **SOLO** in Firebase Functions Config
- ✅ Firebase Functions Config è sicuro e criptato

## 🔍 Verificare la Configurazione

Per vedere tutte le configurazioni:
```bash
firebase functions:config:get
```

Dovresti vedere:
```json
{
  "stripe": {
    "secret_key": "sk_test_...",
    "webhook_secret": "whsec_..."
  },
  "subscription": {
    "price": "500"
  }
}
```

## 🧪 Test

Dopo aver configurato tutto:
1. Vai sulla tua app
2. Clicca "Passa a Premium"
3. Dovresti essere reindirizzato a Stripe Checkout
4. Usa una carta di test: `4242 4242 4242 4242`

## 📚 Riferimenti

- Stripe Dashboard: https://dashboard.stripe.com/test/apikeys
- Firebase Functions Config: https://firebase.google.com/docs/functions/config-env

