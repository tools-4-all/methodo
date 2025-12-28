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
    // Crea o recupera il customer Stripe
    let customerId;
    const userDoc = await db.collection('users').doc(uid).get();
    const userData = userDoc.data();

    if (userData && userData.stripeCustomerId) {
      customerId = userData.stripeCustomerId;
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

    return {
      sessionId: session.id,
      url: session.url,
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
 * Gestisce i webhook di Stripe
 *
 * POST /handleStripeWebhook
 */
exports.handleStripeWebhook = functions.https.onRequest(async (req, res) => {
  const sig = req.headers['stripe-signature'];
  const webhookSecret = functions.config().stripe.webhook_secret;

  let event;

  try {
    event = stripe.webhooks.constructEvent(req.rawBody, sig, webhookSecret);
  } catch (err) {
    console.error('Errore verifica webhook:', err.message);
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

  const subscriptionId = session.subscription;
  const customerId = session.customer;

  // Recupera i dettagli della subscription
  const subscription = await stripe.subscriptions.retrieve(subscriptionId);
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
    },
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  console.log(`Abbonamento attivato per utente ${uid}`);
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

  await db.collection('users').doc(uid).update({
    'subscription.status': subscription.status === 'active' ? 'active' : 'cancelled',
    'subscription.endDate': admin.firestore.Timestamp.fromDate(currentPeriodEnd),
    'subscription.startDate': admin.firestore.Timestamp.fromDate(currentPeriodStart),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  console.log(`Abbonamento aggiornato per utente ${uid}: ${subscription.status}`);
}

/**
 * Gestisce la cancellazione della subscription
 */
async function handleSubscriptionDeleted(subscription) {
  const uid = subscription.metadata && subscription.metadata.firebaseUID;
  if (!uid) {
    console.error('UID non trovato nel metadata della subscription');
    return;
  }

  await db.collection('users').doc(uid).update({
    'subscription.status': 'cancelled',
    'subscription.cancelledAt': admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  console.log(`Abbonamento cancellato per utente ${uid}`);
}

/**
 * Gestisce il pagamento riuscito
 */
async function handlePaymentSucceeded(invoice) {
  const subscriptionId = invoice.subscription;
  if (!subscriptionId) return;

  const subscription = await stripe.subscriptions.retrieve(subscriptionId);
  const uid = subscription.metadata && subscription.metadata.firebaseUID;
  if (!uid) return;

  const currentPeriodEnd = new Date(subscription.current_period_end * 1000);

  await db.collection('users').doc(uid).update({
    'subscription.status': 'active',
    'subscription.endDate': admin.firestore.Timestamp.fromDate(currentPeriodEnd),
    'subscription.lastPaymentDate': admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  console.log(`Pagamento riuscito per utente ${uid}`);
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

