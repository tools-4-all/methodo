# Risoluzione Problema Firebase CLI

## 🔍 Problema
Il comando `firebase` non viene trovato anche se `firebase-tools` è installato.

## ✅ Soluzione

### Opzione 1: Usa il percorso completo (Rapido)

Invece di `firebase`, usa il percorso completo:
```bash
/Users/niccologatti/.npm-global/bin/firebase --version
```

### Opzione 2: Aggiungi al PATH (Permanente)

Aggiungi questa riga al tuo file `~/.zshrc`:

```bash
export PATH="$HOME/.npm-global/bin:$PATH"
```

Poi esegui:
```bash
source ~/.zshrc
```

O apri un nuovo terminale.

### Opzione 3: Crea un alias (Alternativa)

Aggiungi al tuo `~/.zshrc`:
```bash
alias firebase="/Users/niccologatti/.npm-global/bin/firebase"
```

Poi:
```bash
source ~/.zshrc
```

## 🚀 Verifica

Dopo aver aggiunto al PATH, verifica:
```bash
firebase --version
```

Dovresti vedere la versione di firebase-tools.

## 📝 Comandi da Eseguire

### Se usi il percorso completo:
```bash
# Login
/Users/niccologatti/.npm-global/bin/firebase login

# Configura Stripe
/Users/niccologatti/.npm-global/bin/firebase functions:config:set stripe.secret_key="sk_test_..."

# Deploy
/Users/niccologatti/.npm-global/bin/firebase deploy --only functions
```

### Se aggiungi al PATH:
```bash
# Aggiungi al ~/.zshrc
echo 'export PATH="$HOME/.npm-global/bin:$PATH"' >> ~/.zshrc

# Ricarica
source ~/.zshrc

# Ora puoi usare normalmente
firebase login
firebase functions:config:set stripe.secret_key="sk_test_..."
firebase deploy --only functions
```

## 🔧 Verifica Installazione

Per verificare dove è installato:
```bash
ls -la ~/.npm-global/bin/ | grep firebase
```

Dovresti vedere:
```
firebase -> ../lib/node_modules/firebase-tools/lib/bin/firebase.js
```

