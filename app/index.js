/**
 * @format
 */

import { AppRegistry } from 'react-native';
import { name as appName } from './app.json';
import { startBackgroundServices } from './src/background-services';
import { AppShell } from './src/interface/app-shell';

startBackgroundServices();
AppRegistry.registerComponent(appName, () => AppShell);
