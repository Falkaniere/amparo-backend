// Inicialização preguiçosa do Firebase Admin.
// Usado para verificar os ID tokens emitidos pelo login do painel amparo-admin.
// As credenciais vêm de uma service account (Firebase Console > Project Settings >
// Service accounts > Generate new private key) configurada via variáveis de ambiente.

let app = null;
let initTried = false;

function getApp() {
  if (initTried) return app;
  initTried = true;

  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY;

  if (!projectId || !clientEmail || !privateKey) {
    return null;
  }

  // require preguiçoso: só carrega firebase-admin quando há credenciais
  const admin = require('firebase-admin');

  app = admin.apps.length
    ? admin.app()
    : admin.initializeApp({
        credential: admin.credential.cert({
          projectId,
          clientEmail,
          // a chave privada costuma vir com \n escapado nas env vars
          privateKey: privateKey.replace(/\\n/g, '\n'),
        }),
      });

  return app;
}

// Retorna o token decodificado se válido, ou null se o Firebase não estiver
// configurado. Lança erro se o token for inválido/expirado.
async function verifyIdToken(idToken) {
  const firebaseApp = getApp();
  if (!firebaseApp) return null;
  return firebaseApp.auth().verifyIdToken(idToken);
}

function isFirebaseConfigured() {
  return getApp() !== null;
}

module.exports = { verifyIdToken, isFirebaseConfigured };
