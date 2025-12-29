/**
 * Firebase Functions per integrazione Stripe
 *
 * Funzioni:
 * - createCheckoutSession: Crea una sessione Stripe Checkout
 * - handleStripeWebhook: Gestisce i webhook di Stripe per aggiornare lo stato dell'abbonamento
 */

const functions = require('firebase-functions');
const admin = require('firebase-admin');
const stripeConfig = functions.config().stripe || {};
const stripe = require('stripe')(stripeConfig.secret_key || process.env.STRIPE_SECRET_KEY);

admin.initializeApp();

const db = admin.firestore();

/**
 * Crea una sessione Stripe Checkout per l'abbonamento Premium
 *
 * POST /createCheckoutSession
 * Body: { uid: string, email: string }
 */
exports.createCheckoutSession = functions.https.onCall(async (data, context) => {
  // Verifica autenticazione
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'L\'utente deve essere autenticato');
  }

  const uid = context.auth.uid;
  const email = context.auth.token.email || data.email;
  const priceId = functions.config().stripe.price_id; // ID del prezzo in Stripe (opzionale)
  const priceAmount = parseInt(functions.config().subscription.price || '500'); // Default: €5.00

  try {
    // PROTEZIONE: Verifica che non sia già premium (evita doppi pagamenti)
    const userDoc = await db.collection('users').doc(uid).get();
    const userData = userDoc.data();

    if (userData?.subscription?.status === 'active') {
      const endDate = userData.subscription?.endDate?.toDate ?
                      userData.subscription.endDate.toDate() :
                      new Date(userData.subscription?.endDate);
      if (endDate > new Date()) {
        throw new functions.https.HttpsError(
            'already-exists',
            'Hai già un abbonamento Premium attivo',
        );
      }
    }

    // Crea o recupera il customer Stripe
    let customerId;

    if (userData && userData.stripeCustomerId) {
      // Verifica che il customer esista ancora in Stripe
      try {
        await stripe.customers.retrieve(userData.stripeCustomerId);
        customerId = userData.stripeCustomerId;
      } catch (error) {
        // Se il customer non esiste (errore 404 o simile), creane uno nuovo
        if (error.code === 'resource_missing' || error.statusCode === 404) {
          console.warn(`Customer ${userData.stripeCustomerId} non trovato, ne creo uno nuovo`);
          // Rimuovi il customer ID invalido dal database
          await db.collection('users').doc(uid).update({
            stripeCustomerId: admin.firestore.FieldValue.delete(),
          });
          // Crea un nuovo customer
          const customer = await stripe.customers.create({
            email: email,
            metadata: {
              firebaseUID: uid,
            },
          });
          customerId = customer.id;

          // Salva il nuovo customer ID nel profilo utente
          await db.collection('users').doc(uid).update({
            stripeCustomerId: customerId,
          });
        } else {
          // Se è un altro tipo di errore, rilancialo
          throw error;
        }
      }
    } else {
      // Crea un nuovo customer
      const customer = await stripe.customers.create({
        email: email,
        metadata: {
          firebaseUID: uid,
        },
      });
      customerId = customer.id;

      // Salva il customer ID nel profilo utente
      await db.collection('users').doc(uid).update({
        stripeCustomerId: customerId,
      });
    }

    // Crea la sessione Checkout
    const sessionParams = {
      customer: customerId,
      payment_method_types: ['card'],
      mode: 'subscription',
      success_url: `${data.successUrl || 'https://methodo.app/profile.html'}?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: data.cancelUrl || 'https://methodo.app/profile.html?canceled=true',
      metadata: {
        firebaseUID: uid,
      },
      subscription_data: {
        metadata: {
          firebaseUID: uid,
        },
      },
    };

    // Se hai un Price ID in Stripe, usalo, altrimenti crea un prezzo on-the-fly
    if (priceId) {
      sessionParams.line_items = [{
        price: priceId,
        quantity: 1,
      }];
    } else {
      // Crea un prezzo temporaneo (non consigliato per produzione)
      sessionParams.line_items = [{
        price_data: {
          currency: 'eur',
          product_data: {
            name: 'Methodo Premium',
            description: 'Abbonamento mensile Premium',
          },
          recurring: {
            interval: 'month',
          },
          unit_amount: priceAmount,
        },
        quantity: 1,
      }];
    }

    const session = await stripe.checkout.sessions.create(sessionParams);

    // Aggiungi informazioni sulla modalità Stripe per debug
    const isLiveMode = stripeConfig.secret_key && stripeConfig.secret_key.startsWith('sk_live_');
    console.log(`Checkout session creata in modalità: ${isLiveMode ? 'LIVE' : 'TEST'}`);

    return {
      sessionId: session.id,
      url: session.url,
      mode: isLiveMode ? 'live' : 'test', // Informa il frontend sulla modalità
    };
  } catch (error) {
    console.error('Errore creazione checkout session:', error);
    throw new functions.https.HttpsError(
        'internal',
        'Errore durante la creazione della sessione di pagamento',
        error.message,
    );
  }
});

/**
 * Cancella l'abbonamento Stripe (mantiene attivo fino alla fine del periodo)
 */
exports.cancelSubscription = functions.https.onCall(async (data, context) => {
  // Verifica autenticazione
  if (!context.auth) {
    throw new functions.https.HttpsError(
        'unauthenticated',
        'Devi essere autenticato per cancellare l\'abbonamento',
    );
  }

  const uid = context.auth.uid;

  try {
    // Recupera il profilo utente
    const userDoc = await db.collection('users').doc(uid).get();
    if (!userDoc.exists) {
      throw new functions.https.HttpsError(
          'not-found',
          'Profilo utente non trovato',
      );
    }

    const userData = userDoc.data();
    const stripeSubscriptionId = userData.subscription?.stripeSubscriptionId;

    if (!stripeSubscriptionId) {
      throw new functions.https.HttpsError(
          'not-found',
          'Abbonamento Stripe non trovato',
      );
    }

    // Cancella l'abbonamento su Stripe (mantiene attivo fino alla fine del periodo)
    const subscription = await stripe.subscriptions.update(stripeSubscriptionId, {
      cancel_at_period_end: true,
    });

    console.log(`Abbonamento impostato per cancellazione alla fine del periodo per utente ${uid}`);

    // IMPORTANTE: Preserva endDate con current_period_end per permettere l'uso fino alla scadenza
    const currentPeriodEnd = new Date(subscription.current_period_end * 1000);

    // Aggiorna lo status nel database mantenendo endDate valido
    await db.collection('users').doc(uid).update({
      'subscription.status': 'cancelled',
      'subscription.endDate': admin.firestore.Timestamp.fromDate(currentPeriodEnd), // Preserva endDate
      'subscription.cancelledAt': admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    return {
      success: true,
      message: 'Abbonamento cancellato. Rimarrà attivo fino alla fine del periodo.',
      cancelAtPeriodEnd: subscription.cancel_at_period_end,
      currentPeriodEnd: new Date(subscription.current_period_end * 1000).toISOString(),
    };
  } catch (error) {
    console.error('Errore cancellazione abbonamento:', error);
    throw new functions.https.HttpsError(
        'internal',
        'Errore durante la cancellazione dell\'abbonamento',
        error.message,
    );
  }
});

/**
 * Recupera endDate da Stripe se mancante nel database (fix per utenti già cancellati)
 */
exports.fixSubscriptionEndDate = functions.https.onCall(async (data, context) => {
  // Verifica autenticazione
  if (!context.auth) {
    throw new functions.https.HttpsError(
        'unauthenticated',
        'Devi essere autenticato',
    );
  }

  const uid = context.auth.uid;

  try {
    // Recupera il profilo utente
    const userDoc = await db.collection('users').doc(uid).get();
    if (!userDoc.exists) {
      throw new functions.https.HttpsError(
          'not-found',
          'Profilo utente non trovato',
      );
    }

    const userData = userDoc.data();
    const subscription = userData.subscription;

    if (!subscription || !subscription.stripeSubscriptionId) {
      throw new functions.https.HttpsError(
          'not-found',
          'Abbonamento Stripe non trovato',
      );
    }

    // Recupera la subscription da Stripe
    const stripeSubscription = await stripe.subscriptions.retrieve(subscription.stripeSubscriptionId);
    const currentPeriodEnd = new Date(stripeSubscription.current_period_end * 1000);

    // Aggiorna endDate nel database
    await db.collection('users').doc(uid).update({
      'subscription.endDate': admin.firestore.Timestamp.fromDate(currentPeriodEnd),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    return {
      success: true,
      endDate: currentPeriodEnd.toISOString(),
      status: stripeSubscription.status,
      cancel_at_period_end: stripeSubscription.cancel_at_period_end,
    };
  } catch (error) {
    console.error('Errore recupero endDate:', error);
    throw new functions.https.HttpsError(
        'internal',
        'Errore durante il recupero della data di scadenza',
        error.message,
    );
  }
});

/**
 * Gestisce i webhook di Stripe
 *
 * POST /handleStripeWebhook
 */
exports.handleStripeWebhook = functions.https.onRequest(async (req, res) => {
  const sig = req.headers['stripe-signature'];
  const webhookSecret = functions.config().stripe.webhook_secret;
  const isLiveMode = stripeConfig.secret_key && stripeConfig.secret_key.startsWith('sk_live_');

  // Log per debug: indica la modalità Stripe
  console.log(`Webhook ricevuto - Modalità Stripe: ${isLiveMode ? 'LIVE' : 'TEST'}`);

  let event;

  try {
    event = stripe.webhooks.constructEvent(req.rawBody, sig, webhookSecret);
    console.log(`Webhook verificato - Evento: ${event.type} - Modalità: ${isLiveMode ? 'LIVE' : 'TEST'}`);
  } catch (err) {
    console.error('Errore verifica webhook:', err.message);
    console.error(`Modalità Stripe configurata: ${isLiveMode ? 'LIVE' : 'TEST'}`);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // Gestisci i diversi tipi di eventi
  switch (event.type) {
    case 'checkout.session.completed':
      await handleCheckoutCompleted(event.data.object);
      break;

    case 'customer.subscription.updated':
      await handleSubscriptionUpdated(event.data.object);
      break;

    case 'customer.subscription.deleted':
      await handleSubscriptionDeleted(event.data.object);
      break;

    case 'invoice.payment_succeeded':
      await handlePaymentSucceeded(event.data.object);
      break;

    case 'invoice.payment_failed':
      await handlePaymentFailed(event.data.object);
      break;

    default:
      console.log(`Evento non gestito: ${event.type}`);
  }

  res.json({received: true});
});

/**
 * Gestisce il completamento del checkout
 */
async function handleCheckoutCompleted(session) {
  const uid = session.metadata && session.metadata.firebaseUID;
  if (!uid) {
    console.error('UID non trovato nel metadata della sessione');
    return;
  }

  // IMPORTANTE: Verifica che il pagamento sia stato completato con successo
  if (session.payment_status !== 'paid') {
    console.warn(`Checkout completato ma pagamento non completato per utente ${uid}. Payment status: ${session.payment_status}`);
    return;
  }

  const subscriptionId = session.subscription;
  const customerId = session.customer;

  if (!subscriptionId) {
    console.error('Subscription ID non trovato nella sessione');
    return;
  }

  // Recupera i dettagli della subscription
  const subscription = await stripe.subscriptions.retrieve(subscriptionId);

  // Verifica che la subscription sia attiva
  if (subscription.status !== 'active' && subscription.status !== 'trialing') {
    console.warn(`Subscription non attiva per utente ${uid}. Status: ${subscription.status}`);
    return;
  }

  // PROTEZIONE: Verifica che non sia una carta di test (solo in produzione)
  // In modalità test, Stripe usa prefissi specifici per le carte di test
  // Controlliamo se siamo in modalità live e se il pagamento è reale
  const isLiveMode = stripeConfig.secret_key && stripeConfig.secret_key.startsWith('sk_live_');

  if (isLiveMode) {
    // In produzione, verifica che il pagamento sia reale
    // Recupera il payment intent per verificare i dettagli
    try {
      const paymentIntentId = session.payment_intent;
      if (paymentIntentId) {
        const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);

        // Verifica che il metodo di pagamento non sia una carta di test
        if (paymentIntent.payment_method) {
          const paymentMethod = await stripe.paymentMethods.retrieve(paymentIntent.payment_method);

          // Le carte di test hanno pattern specifici (es. 4242 4242 4242 4242)
          // In produzione, Stripe non dovrebbe accettare carte di test
          // Ma aggiungiamo un controllo extra per sicurezza
          if (paymentMethod.card) {
            const last4 = paymentMethod.card.last4;
            // Pattern comuni di carte di test (solo per sicurezza extra)
            const testCardPatterns = ['4242', '4000', '5555'];
            if (testCardPatterns.includes(last4) && isLiveMode) {
              console.warn(`Tentativo di usare carta di test in produzione per utente ${uid}`);
              // Non attiviamo il premium se è una carta di test in produzione
              return;
            }
          }
        }
      }
    } catch (error) {
      console.error('Errore nella verifica del payment intent:', error);
      // In caso di errore, procediamo comunque (potrebbe essere un pagamento one-time)
    }
  }

  const currentPeriodEnd = new Date(subscription.current_period_end * 1000);
  const currentPeriodStart = new Date(subscription.current_period_start * 1000);

  // Aggiorna il profilo utente
  await db.collection('users').doc(uid).update({
    subscription: {
      status: 'active',
      stripeSubscriptionId: subscriptionId,
      stripeCustomerId: customerId,
      startDate: admin.firestore.Timestamp.fromDate(currentPeriodStart),
      endDate: admin.firestore.Timestamp.fromDate(currentPeriodEnd),
      type: 'monthly',
      price: subscription.items.data[0].price.unit_amount / 100, // Converti da centesimi
      lastPaymentDate: admin.firestore.FieldValue.serverTimestamp(),
      activatedAt: admin.firestore.FieldValue.serverTimestamp(),
      // Aggiungi flag per indicare che è un pagamento verificato
      verified: true,
    },
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  console.log(`Abbonamento attivato per utente ${uid} (verificato)`);
}

/**
 * Gestisce l'aggiornamento della subscription
 */
async function handleSubscriptionUpdated(subscription) {
  const uid = subscription.metadata && subscription.metadata.firebaseUID;
  if (!uid) {
    console.error('UID non trovato nel metadata della subscription');
    return;
  }

  const currentPeriodEnd = new Date(subscription.current_period_end * 1000);
  const currentPeriodStart = new Date(subscription.current_period_start * 1000);

  // Determina lo status: se cancel_at_period_end è true, considera come 'cancelled' ma mantiene endDate
  let status = subscription.status;
  if (subscription.cancel_at_period_end === true) {
    status = 'cancelled'; // Anche se status è ancora 'active', lo trattiamo come 'cancelled'
  } else if (subscription.status === 'active') {
    status = 'active';
  } else {
    status = 'cancelled';
  }

  await db.collection('users').doc(uid).update({
    'subscription.status': status,
    'subscription.endDate': admin.firestore.Timestamp.fromDate(currentPeriodEnd), // Sempre aggiorna endDate
    'subscription.startDate': admin.firestore.Timestamp.fromDate(currentPeriodStart),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  console.log(`Abbonamento aggiornato per utente ${uid}: status=${status}, cancel_at_period_end=${subscription.cancel_at_period_end}, endDate=${currentPeriodEnd.toISOString()}`);
}

/**
 * Gestisce la cancellazione della subscription
 * IMPORTANTE: Non modifica endDate per permettere l'uso fino alla fine del periodo pagato
 */
async function handleSubscriptionDeleted(subscription) {
  const uid = subscription.metadata && subscription.metadata.firebaseUID;
  if (!uid) {
    console.error('UID non trovato nel metadata della subscription');
    return;
  }

  // Recupera il profilo esistente per preservare endDate
  const userDoc = await db.collection('users').doc(uid).get();
  const userData = userDoc.exists ? userDoc.data() : null;
  const existingEndDate = userData?.subscription?.endDate;

  // Se endDate esiste ed è nel futuro, preservalo. Altrimenti usa current_period_end se disponibile
  let endDateToKeep = existingEndDate;
  if (subscription.current_period_end) {
    const currentPeriodEnd = new Date(subscription.current_period_end * 1000);
    const existingEndDateValue = existingEndDate?.toDate ? existingEndDate.toDate() : new Date(existingEndDate);

    // Usa la data più lontana tra quella esistente e current_period_end
    if (!existingEndDate || currentPeriodEnd > existingEndDateValue) {
      endDateToKeep = admin.firestore.Timestamp.fromDate(currentPeriodEnd);
    }
  }

  const updateData = {
    'subscription.status': 'cancelled',
    'subscription.cancelledAt': admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };

  // Preserva endDate solo se esiste ed è valido
  if (endDateToKeep) {
    updateData['subscription.endDate'] = endDateToKeep;
  }

  await db.collection('users').doc(uid).update(updateData);

  console.log(`Abbonamento cancellato per utente ${uid}. EndDate preservato: ${endDateToKeep ? 'sì' : 'no'}`);
}

/**
 * Gestisce il pagamento riuscito
 */
async function handlePaymentSucceeded(invoice) {
  const subscriptionId = invoice.subscription;
  if (!subscriptionId) return;

  // Verifica che l'invoice sia pagato
  if (invoice.paid !== true) {
    console.warn(`Invoice non pagato: ${invoice.id}`);
    return;
  }

  const subscription = await stripe.subscriptions.retrieve(subscriptionId);
  const uid = subscription.metadata && subscription.metadata.firebaseUID;
  if (!uid) return;

  // Verifica che la subscription sia ancora attiva
  if (subscription.status !== 'active' && subscription.status !== 'trialing') {
    console.warn(`Subscription non attiva per utente ${uid}. Status: ${subscription.status}`);
    return;
  }

  const currentPeriodEnd = new Date(subscription.current_period_end * 1000);

  await db.collection('users').doc(uid).update({
    'subscription.status': 'active',
    'subscription.endDate': admin.firestore.Timestamp.fromDate(currentPeriodEnd),
    'subscription.lastPaymentDate': admin.firestore.FieldValue.serverTimestamp(),
    'subscription.verified': true, // Marca come verificato
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  console.log(`Pagamento riuscito e verificato per utente ${uid}`);
}

/**
 * Gestisce il pagamento fallito
 */
async function handlePaymentFailed(invoice) {
  const subscriptionId = invoice.subscription;
  if (!subscriptionId) return;

  const subscription = await stripe.subscriptions.retrieve(subscriptionId);
  const uid = subscription.metadata && subscription.metadata.firebaseUID;
  if (!uid) return;

  // Non cancelliamo subito, Stripe proverà a riscuotere di nuovo
  // Possiamo inviare una notifica all'utente
  console.log(`Pagamento fallito per utente ${uid}`);
  // TODO: Invia email di notifica all'utente
}

