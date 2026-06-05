import { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.maritech.trading',
  appName: 'MariTech',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
    // Point this to your live production website URL
    // When the APK starts, it will instantly stream the fully interactive web app
    // and route all backend D1 / cashier requests natively.
    url: 'https://ais-pre-wckffqlqyxp2fbdy72pdco-883535415774.europe-west2.run.app',
    allowNavigation: [
      'ais-pre-wckffqlqyxp2fbdy72pdco-883535415774.europe-west2.run.app',
      'ais-dev-wckffqlqyxp2fbdy72pdco-883535415774.europe-west2.run.app'
    ]
  }
};

export default config;
