// Entry point. polyfills MUST load before anything touches crypto/Buffer.
import "./src/polyfills";
import { registerRootComponent } from "expo";
import App from "./App";

// registerRootComponent === AppRegistry.registerComponent('main', () => App)
registerRootComponent(App);
