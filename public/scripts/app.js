import { initializeApp } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-app.js";

const firebaseConfig = {
  apiKey: "AIzaSyANJZu_GBXtBnza9wsw7bCXF2ERm4dVy4M",
  authDomain: "moorecoin.firebaseapp.com",
  projectId: "moorecoin",
  storageBucket: "moorecoin.firebasestorage.app",
  messagingSenderId: "230465147128",
  appId: "1:230465147128:web:38ad51e294357cbbbfeb0d",
  measurementId: "G-VLW5VDKEFS",
};

export const app = initializeApp(firebaseConfig);
export const apiBase =
  location.hostname === "localhost" || location.hostname === "127.0.0.1"
    ? "http://127.0.0.1:5000"
    : "https://api.mooreco.in";
