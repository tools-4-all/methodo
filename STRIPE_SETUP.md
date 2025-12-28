# Setup Stripe per Pagamenti Premium

Questa guida ti aiuterà a configurare Stripe per i pagamenti reali.

## 1. Creare un account Stripe

1. Vai su https://stripe.com e crea un account
2. Vai su **Developers > API keys**
3. Copia la **Publishable key** e la **Secret key** (test mode)
4. Per produzione, usa le chiavi in **Live mode**

## 2. Installare Firebase Functions

```bash
# Installa Firebase CLI globalmente
npm install -g firebase-tools

# Login a Firebase
firebase login

# Inizializza Functions (se non già fatto)
firebase init functions

# Scegli:
# - JavaScript o TypeScript (consiglio TypeScript)
# - Installa dipendenze? Sì
```

## 3. Configurare le variabili d'ambiente

```bash
# Imposta le chiavi Stripe (test mode)
firebase functions:config:set stripe.secret_key="sk_test_..."

# Per produzione:
firebase functions:config:set stripe.secret_key="sk_live_..."

# Imposta il prezzo mensile (in centesimi, es. 500 = €5.00)
firebase functions:config:set subscription.price="500"
```

## 4. Deploy delle Functions

```bash
# Deploy solo le functions
firebase deploy --only functions

# Oppure deploy completo
firebase deploy
```

## 5. Configurare il Webhook di Stripe

1. Vai su **Stripe Dashboard > Developers > Webhooks**
2. Clicca **Add endpoint**
3. URL: `https://YOUR-PROJECT-ID.cloudfunctions.net/handleStripeWebhook`
4. Eventi da ascoltare:
   - `checkout.session.completed`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
5. Copia il **Signing secret** del webhook
6. Configuralo in Firebase:
   ```bash
   firebase functions:config:set stripe.webhook_secret="whsec_..."
   ```

## 6. Aggiornare il frontend

Il file `app.js` è già stato aggiornato per chiamare Stripe Checkout. Assicurati che:
- La funzione `createCheckoutSession` punti al tuo endpoint Firebase Functions
- Il modal di upgrade sia collegato correttamente

## 7. Test

1. Usa le carte di test di Stripe:
   - Successo: `4242 4242 4242 4242`
   - Scaduta: `4000 0000 0000 0002`
   - Rifiutata: `4000 0000 0000 0005`
2. CVC: qualsiasi 3 cifre
3. Data: qualsiasi data futura

## 8. Passare alla produzione

1. Cambia le chiavi Stripe in **Live mode**
2. Aggiorna il webhook con l'URL di produzione
3. Deploy delle functions con le nuove chiavi
4. Testa con una piccola transazione reale

## Note importanti

- **Sicurezza**: Non esporre mai la Secret key nel frontend
- **Webhook**: Assicurati che il webhook sia configurato correttamente
- **Testing**: Usa sempre la modalità test prima di andare in produzione
- **Logs**: Monitora i logs di Firebase Functions per debug

## Supporto

Per problemi:
- Stripe Docs: https://stripe.com/docs
- Firebase Functions: https://firebase.google.com/docs/functions

