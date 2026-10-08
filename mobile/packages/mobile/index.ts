import { registerRootComponent } from 'expo';
import * as Crypto from 'expo-crypto';
import { configureRandomBytes } from './src/core/uuid';

configureRandomBytes((a) => Crypto.getRandomValues(a) as Uint8Array);   // Hermes has no global crypto; use the platform's secure RNG
import App from './App';
registerRootComponent(App);
