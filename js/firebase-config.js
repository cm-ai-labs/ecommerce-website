import { initializeApp } from "https://www.gstatic.com/firebasejs/12.8.0/firebase-app.js";
import { getAuth } from 'https://www.gstatic.com/firebasejs/12.8.0/firebase-auth.js';
import { getFirestore } from 'https://www.gstatic.com/firebasejs/12.8.0/firebase-firestore.js';


const firebaseConfig = {
  apiKey: "AIzaSyAij8VCeiD6AJH9tUGIUMpHZQZ3LEuAdIg",
  authDomain: "ecommerce-website-93c85.firebaseapp.com",
  databaseURL: "https://ecommerce-website-93c85-default-rtdb.firebaseio.com",
  projectId: "ecommerce-website-93c85",
  storageBucket: "ecommerce-website-93c85.firebasestorage.app",
  messagingSenderId: "99006677444",
  appId: "1:99006677444:web:e796c429bac7b92b306491"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
