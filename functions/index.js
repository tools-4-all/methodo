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
 * Attiva Premium usando un promo code
 * Verifica che il codice esista, non sia già usato, e attiva Premium per l'utente
 */
exports.activatePromoCode = functions.https.onCall(async (data, context) => {
  // Verifica autenticazione
  if (!context.auth) {
    throw new functions.https.HttpsError(
        'unauthenticated',
        'Devi essere autenticato per usare un promo code',
    );
  }

  const uid = context.auth.uid;
  const code = data.code?.trim().toUpperCase();

  if (!code) {
    throw new functions.https.HttpsError(
        'invalid-argument',
        'Codice promozionale non valido',
    );
  }

  try {
    // Usa una transazione per evitare race conditions
    const promoCodeRef = db.collection('promoCodes').doc(code);

    return await db.runTransaction(async (transaction) => {
      const promoCodeDoc = await transaction.get(promoCodeRef);

      if (!promoCodeDoc.exists) {
        throw new functions.https.HttpsError(
            'not-found',
            'Codice promozionale non trovato',
        );
      }

      const promoCodeData = promoCodeDoc.data();

      // Verifica che il codice sia attivo
      if (promoCodeData.active === false) {
        throw new functions.https.HttpsError(
            'permission-denied',
            'Codice promozionale disattivato',
        );
      }

      // Verifica che non sia già stato usato
      if (promoCodeData.usedBy) {
        throw new functions.https.HttpsError(
            'already-exists',
            'Codice promozionale già utilizzato',
        );
      }

      // Verifica scadenza (se presente)
      if (promoCodeData.expiresAt) {
        const expiresAt = promoCodeData.expiresAt.toDate ?
                          promoCodeData.expiresAt.toDate() :
                          new Date(promoCodeData.expiresAt);
        if (expiresAt < new Date()) {
          throw new functions.https.HttpsError(
              'deadline-exceeded',
              'Codice promozionale scaduto',
          );
        }
      }

      // Calcola endDate (default: 30 giorni da ora, o usa durationDays se specificato)
      const durationDays = promoCodeData.durationDays || 30;
      const endDate = new Date();
      endDate.setDate(endDate.getDate() + durationDays);
      const startDate = new Date();

      // Marca il codice come usato
      transaction.update(promoCodeRef, {
        usedBy: uid,
        usedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      // Attiva Premium per l'utente
      const userRef = db.collection('users').doc(uid);
      transaction.update(userRef, {
        subscription: {
          status: 'active',
          startDate: admin.firestore.Timestamp.fromDate(startDate),
          endDate: admin.firestore.Timestamp.fromDate(endDate),
          type: 'promo',
          price: 0,
          promoCode: code,
          verified: true, // I promo code sono sempre verificati
          activatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      console.log(`Promo code ${code} attivato per utente ${uid}`);

      return {
        success: true,
        message: 'Premium attivato con successo!',
        endDate: endDate.toISOString(),
        days: durationDays,
      };
    });
  } catch (error) {
    console.error('Errore attivazione promo code:', error);

    // Se è già un HttpsError, rilancialo
    if (error instanceof functions.https.HttpsError) {
      throw error;
    }

    // Altrimenti, crea un errore generico
    throw new functions.https.HttpsError(
        'internal',
        'Errore durante l\'attivazione del codice promozionale',
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

/**
 * Genera o recupera il codice referral di un utente
 * Ogni utente ha un codice unico basato sul suo UID
 */
exports.getReferralCode = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError(
        'unauthenticated',
        'Devi essere autenticato per ottenere il tuo codice referral',
    );
  }

  const uid = context.auth.uid;

  try {
    // Recupera o crea il codice referral per l'utente
    const userRef = db.collection('users').doc(uid);
    const userDoc = await userRef.get();

    let referralCode;
    if (userDoc.exists && userDoc.data().referralCode) {
      referralCode = userDoc.data().referralCode;
      console.log(`[Referral] Codice referral esistente per ${uid}: ${referralCode}`);
    } else {
      // Genera un codice unico basato sull'UID (primi 8 caratteri dell'UID)
      // Aggiungi un prefisso per renderlo più riconoscibile
      referralCode = `REF${uid.substring(0, 8).toUpperCase()}`;

      // Verifica che non esista già (molto improbabile ma meglio controllare)
      const existingRef = await db.collection('users')
          .where('referralCode', '==', referralCode)
          .limit(1)
          .get();

      if (!existingRef.empty) {
        // Se esiste già, usa l'UID completo
        referralCode = `REF${uid.toUpperCase().replace(/[^A-Z0-9]/g, '').substring(0, 12)}`;
      }

      // Salva il codice nel profilo utente
      await userRef.set({
        referralCode: referralCode,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, {merge: true});

      console.log(`[Referral] Codice referral generato e salvato per ${uid}: ${referralCode}`);
    }

    // Verifica che il codice sia stato salvato correttamente
    const verifyDoc = await userRef.get();
    const savedCode = verifyDoc.data()?.referralCode;
    if (savedCode !== referralCode) {
      console.error(`[Referral] ERRORE: Codice non salvato correttamente! Atteso: ${referralCode}, Trovato: ${savedCode}`);
      // Prova a salvare di nuovo
      await userRef.set({
        referralCode: referralCode,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, {merge: true});
    }

    return {
      success: true,
      referralCode: referralCode,
      referralUrl: `https://methodo.app/index.html?ref=${referralCode}`,
    };
  } catch (error) {
    console.error('Errore generazione codice referral:', error);
    throw new functions.https.HttpsError(
        'internal',
        'Errore durante la generazione del codice referral',
        error.message,
    );
  }
});

/**
 * Processa un referral quando un nuovo utente si registra
 * Verifica che il referral sia valido e attiva Premium per entrambi
 */
exports.processReferral = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError(
        'unauthenticated',
        'Devi essere autenticato per processare un referral',
    );
  }

  const newUserUid = context.auth.uid;
  const referralCode = data.referralCode?.trim().toUpperCase();

  if (!referralCode) {
    throw new functions.https.HttpsError(
        'invalid-argument',
        'Codice referral non valido',
    );
  }

  try {
    console.log(`[Referral] Processamento referral: codice=${referralCode}, nuovoUtente=${newUserUid}`);

    // Trova l'utente che ha generato il referral (FUORI dalla transazione per permettere query)
    let referrerQuery;
    try {
      referrerQuery = await db.collection('users')
          .where('referralCode', '==', referralCode)
          .limit(1)
          .get();
      console.log(`[Referral] Query referral trovati: ${referrerQuery.size}`);
      console.log(`[Referral] Codice cercato: ${referralCode}`);
    } catch (queryError) {
      console.error(`[Referral] ❌ ERRORE nella query Firestore:`, queryError);
      console.error(`[Referral] Dettagli errore:`, {
        code: queryError.code,
        message: queryError.message,
        stack: queryError.stack,
      });

      // Se è un errore di indice mancante, fornisci un messaggio più utile
      if (queryError.code === 8 || queryError.message?.includes('index')) {
        throw new functions.https.HttpsError(
            'failed-precondition',
            'Indice Firestore mancante per referralCode. Contatta il supporto.',
        );
      }

      throw queryError;
    }

    // Se il codice non viene trovato, prova a generarlo automaticamente
    // Il formato del codice è REF{UID8}, quindi possiamo estrarre l'UID prefix
    if (referrerQuery.empty) {
      console.log(`[Referral] Codice non trovato, provo a generarlo automaticamente...`);

      // Estrai l'UID prefix dal codice (formato: REF{UID8})
      if (referralCode.startsWith('REF') && referralCode.length >= 11) {
        const uidPrefix = referralCode.substring(3).toUpperCase(); // Rimuovi "REF"

        console.log(`[Referral] Tentativo di trovare utente con UID che inizia con: ${uidPrefix}`);
        console.log(`[Referral] Cercherò tra tutti gli utenti per trovare quello con UID che genera questo codice...`);

        // Strategia migliorata: cerca tutti gli utenti e verifica se il loro referral code generato corrisponde
        // Usiamo un batch per essere più efficienti
        let foundUser = null;
        let lastDoc = null;
        const batchSize = 500;
        let totalChecked = 0;

        // Cerca in batch fino a trovare l'utente o finire tutti gli utenti
        while (!foundUser) {
          let query = db.collection('users').limit(batchSize);
          if (lastDoc) {
            query = query.startAfter(lastDoc);
          }

          const batch = await query.get();

          if (batch.empty) {
            console.log(`[Referral] Nessun altro utente da controllare. Totale controllati: ${totalChecked}`);
            break;
          }

          console.log(`[Referral] Controllando batch di ${batch.size} utenti... (totale: ${totalChecked + batch.size})`);

          for (const userDoc of batch.docs) {
            totalChecked++;
            const userUid = userDoc.id;

            // Genera il referral code per questo UID
            const generatedCode = `REF${userUid.substring(0, 8).toUpperCase()}`;

            // Se il codice generato corrisponde, abbiamo trovato l'utente
            if (generatedCode === referralCode) {
              foundUser = userDoc;
              console.log(`[Referral] ✅ Utente trovato! UID: ${userUid}, Codice: ${referralCode}`);

              // Salva il referral code FUORI dalla transazione
              await db.collection('users').doc(userUid).set({
                referralCode: referralCode,
                updatedAt: admin.firestore.FieldValue.serverTimestamp(),
              }, {merge: true});

              console.log(`[Referral] ✅ Codice generato e salvato automaticamente per ${userUid}: ${referralCode}`);
              break;
            }
          }

          // Prepara per il prossimo batch
          if (!batch.empty && !foundUser) {
            lastDoc = batch.docs[batch.docs.length - 1];
          } else {
            break;
          }

          // Limite di sicurezza: non cercare più di 5000 utenti
          if (totalChecked >= 5000) {
            console.warn(`[Referral] ⚠️ Raggiunto limite di ricerca (5000 utenti)`);
            break;
          }
        }

        if (foundUser) {
          // Ricarica la query dopo aver salvato il codice
          referrerQuery = await db.collection('users')
              .where('referralCode', '==', referralCode)
              .limit(1)
              .get();
          console.log(`[Referral] Query dopo generazione: ${referrerQuery.size} risultati`);
        } else {
          console.error(`[Referral] ❌ Utente non trovato dopo aver controllato ${totalChecked} utenti`);
          console.error(`[Referral] Codice cercato: ${referralCode}, UID prefix: ${uidPrefix}`);
        }
      }

      // Se ancora non trovato dopo tutti i tentativi
      if (referrerQuery.empty) {
        console.error(`[Referral] ❌ Codice referral non trovato dopo tutti i tentativi: ${referralCode}`);
        console.error(`[Referral] Verifica che:`);
        console.error(`[Referral] 1. Il codice referral sia corretto`);
        console.error(`[Referral] 2. L'utente che ha generato il link esista nel database`);
        console.error(`[Referral] 3. L'utente che ha generato il link abbia visitato la pagina profilo per generare il codice`);

        throw new functions.https.HttpsError(
            'not-found',
            'Codice referral non trovato. Verifica che il link sia corretto e che l\'utente che ha generato il link esista.',
        );
      }
    }

    // Verifica che abbiamo trovato un referrer prima di iniziare la transazione
    if (referrerQuery.empty || referrerQuery.docs.length === 0) {
      console.error(`[Referral] ❌ ERRORE: referrerQuery è vuoto prima della transazione`);
      throw new functions.https.HttpsError(
          'not-found',
          'Codice referral non trovato. Verifica che il link sia corretto.',
      );
    }

    return await db.runTransaction(async (transaction) => {
      try {
        const referrerDoc = referrerQuery.docs[0];
        const referrerUid = referrerDoc.id;
        const referrerData = referrerDoc.data();

        console.log(`[Referral] Referrer trovato: ${referrerUid}, referralsCount: ${referrerData.referralsCount || 0}`);

        // SICUREZZA: Verifica che non sia auto-referral
        if (referrerUid === newUserUid) {
          console.error(`[Referral] Tentativo di auto-referral: ${newUserUid}`);
          throw new functions.https.HttpsError(
              'permission-denied',
              'Non puoi usare il tuo stesso codice referral',
          );
        }

        // SICUREZZA: Verifica che il nuovo utente sia effettivamente nuovo
        // Controlla se ha già un referral processato
        const newUserRef = db.collection('users').doc(newUserUid);
        const newUserDoc = await transaction.get(newUserRef);

        if (newUserDoc.exists) {
          const newUserData = newUserDoc.data();

          // Se ha già un referral processato, rifiuta
          if (newUserData.referralProcessed === true) {
            throw new functions.https.HttpsError(
                'already-exists',
                'Hai già utilizzato un codice referral',
            );
          }

          // Verifica che l'account sia stato creato di recente (max 24 ore fa)
          // Questo previene che utenti esistenti usino referral
          // Usa metadata.creationTime se disponibile, altrimenti auth_time
          let accountCreated;
          if (newUserData.createdAt) {
            accountCreated = newUserData.createdAt.toDate ?
                          newUserData.createdAt.toDate().getTime() :
                          new Date(newUserData.createdAt).getTime();
          } else {
            accountCreated = context.auth.token.auth_time * 1000; // Firebase Auth timestamp
          }

          const now = Date.now();
          const hoursSinceCreation = (now - accountCreated) / (1000 * 60 * 60);

          console.log(`[Referral] Account creato ${hoursSinceCreation.toFixed(2)} ore fa`);

          // Aumentiamo il limite a 48 ore per dare più tempo
          if (hoursSinceCreation > 48) {
            throw new functions.https.HttpsError(
                'deadline-exceeded',
                'Il codice referral può essere utilizzato solo entro 48 ore dalla registrazione',
            );
          }
        }

        // SICUREZZA: Verifica che il referrer non abbia già troppi referral
        // Limita a 10 referral per utente per prevenire abusi
        const referralsCount = referrerData.referralsCount || 0;
        if (referralsCount >= 10) {
          throw new functions.https.HttpsError(
              'resource-exhausted',
              'Questo utente ha raggiunto il limite di referral',
          );
        }

        // Calcola le date per Premium (7 giorni)
        const premiumStartDate = new Date();
        const premiumEndDate = new Date();
        premiumEndDate.setDate(premiumEndDate.getDate() + 7);

        // Aggiorna il nuovo utente con Premium
        const newUserData = newUserDoc.exists ? newUserDoc.data() : null;
        const newUserSubscription = newUserData?.subscription;
        let newUserEndDate = premiumEndDate;

        // Se ha già Premium, estendi la data di scadenza
        if (newUserSubscription && newUserSubscription.endDate) {
          const existingEndDate = newUserSubscription.endDate.toDate ?
                                newUserSubscription.endDate.toDate() :
                                new Date(newUserSubscription.endDate);

          if (existingEndDate > premiumEndDate) {
            newUserEndDate = existingEndDate;
          } else {
          // Estendi di 7 giorni dalla data esistente
            newUserEndDate = new Date(existingEndDate);
            newUserEndDate.setDate(newUserEndDate.getDate() + 7);
          }
        }

        // Usa set se il documento non esiste, update se esiste
        const newUserUpdateData = {
          referralProcessed: true,
          referredBy: referrerUid,
          referralCodeUsed: referralCode,
          referralProcessedAt: admin.firestore.FieldValue.serverTimestamp(),
          subscription: {
            status: 'active',
            startDate: admin.firestore.Timestamp.fromDate(premiumStartDate),
            endDate: admin.firestore.Timestamp.fromDate(newUserEndDate),
            type: 'referral',
            price: 0,
            verified: true,
            activatedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        };

        // Se il documento esiste, aggiungi anche i campi base
        if (!newUserDoc.exists) {
          newUserUpdateData.email = context.auth.token.email || '';
          newUserUpdateData.createdAt = admin.firestore.FieldValue.serverTimestamp();
        }

        if (newUserDoc.exists) {
          transaction.update(newUserRef, newUserUpdateData);
        } else {
          transaction.set(newUserRef, newUserUpdateData);
        }

        // Aggiorna il referrer con Premium e incrementa il contatore
        const referrerRef = db.collection('users').doc(referrerUid);
        const referrerSubscription = referrerData.subscription;
        let referrerEndDate = premiumEndDate;

        // Se ha già Premium, estendi la data di scadenza
        if (referrerSubscription && referrerSubscription.endDate) {
          const existingEndDate = referrerSubscription.endDate.toDate ?
                                referrerSubscription.endDate.toDate() :
                                new Date(referrerSubscription.endDate);

          if (existingEndDate > premiumEndDate) {
            referrerEndDate = existingEndDate;
          } else {
          // Estendi di 7 giorni dalla data esistente
            referrerEndDate = new Date(existingEndDate);
            referrerEndDate.setDate(referrerEndDate.getDate() + 7);
          }
        }

      transaction.update(referrerRef, {
        referralsCount: admin.firestore.FieldValue.increment(1),
        referrals: admin.firestore.FieldValue.arrayUnion({
          referredUser: newUserUid,
          referredAt: admin.firestore.Timestamp.now(),
        }),
          subscription: {
            status: 'active',
            startDate: admin.firestore.Timestamp.fromDate(premiumStartDate),
            endDate: admin.firestore.Timestamp.fromDate(referrerEndDate),
            type: referrerSubscription?.type || 'referral',
            price: referrerSubscription?.price || 0,
            verified: true,
            activatedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });

        // Crea un documento di tracciamento referral
        const referralTrackingRef = db.collection('referrals').doc();
        transaction.set(referralTrackingRef, {
          referrerUid: referrerUid,
          referredUserUid: newUserUid,
          referralCode: referralCode,
          processedAt: admin.firestore.FieldValue.serverTimestamp(),
          verified: true,
        });

        console.log(`Referral processato: ${referrerUid} -> ${newUserUid}`);

        return {
          success: true,
          message: 'Referral processato con successo! Hai ricevuto 7 giorni di Premium.',
          premiumEndDate: newUserEndDate.toISOString(),
        };
      } catch (transactionError) {
        console.error('[Referral] ❌ ERRORE nella transazione:', transactionError);
        console.error('[Referral] Dettagli errore transazione:', {
          code: transactionError.code,
          message: transactionError.message,
          stack: transactionError.stack,
        });

        // Se è già un HttpsError, rilancialo
        if (transactionError instanceof functions.https.HttpsError) {
          throw transactionError;
        }

        // Altrimenti, rilancia l'errore della transazione
        throw transactionError;
      }
    });
  } catch (error) {
    console.error('[Referral] ❌ ERRORE processamento referral:', error);
    console.error('[Referral] Dettagli errore completo:', {
      name: error.name,
      code: error.code,
      message: error.message,
      stack: error.stack,
      toString: error.toString(),
    });

    // Se è già un HttpsError, rilancialo
    if (error instanceof functions.https.HttpsError) {
      throw error;
    }

    // Altrimenti, crea un errore generico con più dettagli
    throw new functions.https.HttpsError(
        'internal',
        `Errore durante il processamento del referral: ${error.message || 'Errore sconosciuto'}`,
        {
          originalError: error.message,
          code: error.code,
          stack: error.stack,
        },
    );
  }
});

