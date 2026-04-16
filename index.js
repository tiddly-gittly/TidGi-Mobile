import { registerRootComponent } from "expo";
import { install } from "react-native-quick-crypto";
import App from "./App";

install();

registerRootComponent(App);
