/**
 * api/_firebase.js — Inicialización compartida de Firebase Admin SDK
 *
 * El prefijo _ impide que Vercel lo exponga como endpoint HTTP.
 * Importado por api/db.js y api/analytics.js con require('./_firebase').
 *
 * Si en el futuro se agrega un tercer endpoint que use Firestore,
 * importar desde acá en lugar de duplicar la inicialización.
 */

const { initializeApp, getApps, cert } = require('firebase-admin/app');
const { getFirestore, FieldValue }      = require('firebase-admin/firestore');

function getDb() {
  if (!getApps().length) {
    initializeApp({
      credential: cert({
        projectId:   process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey:  process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n')
      })
    });
  }
  return getFirestore();
}

module.exports = { getDb, FieldValue };
