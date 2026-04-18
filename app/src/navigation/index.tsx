import React, { useEffect, useState } from 'react';
import { View, ActivityIndicator } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { tokenManager } from '../auth/TokenManager';
import { LoginScreen } from '../screens/LoginScreen';
import { DashboardScreen } from '../screens/DashboardScreen';
import { SettingsScreen } from '../screens/SettingsScreen';
import { T } from '../theme';

export type RootStackParamList = {
  Login: undefined;
  Dashboard: undefined;
  Settings: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();

export function AppNavigator() {
  const [isLoggedIn, setIsLoggedIn] = useState<boolean | null>(null);

  useEffect(() => {
    tokenManager.isLoggedIn().then(setIsLoggedIn);
  }, []);

  if (isLoggedIn === null) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: T.bg }}>
        <ActivityIndicator color={T.primary} size="large" />
      </View>
    );
  }

  return (
    <NavigationContainer>
      <Stack.Navigator
        screenOptions={{
          headerStyle: { backgroundColor: T.surface },
          headerTintColor: T.text,
          headerTitleStyle: { fontWeight: 'bold' },
          contentStyle: { backgroundColor: T.bg },
        }}
      >
        {isLoggedIn ? (
          <Stack.Screen name="Dashboard" options={{ headerShown: false }} component={DashboardScreen} />
        ) : (
          <Stack.Screen name="Login" options={{ headerShown: false }}>
            {() => <LoginScreen onLoginSuccess={() => setIsLoggedIn(true)} />}
          </Stack.Screen>
        )}
        {/* Settings is reachable from both Login and Dashboard */}
        <Stack.Screen name="Settings" options={{ title: 'Settings' }}>
          {() => <SettingsScreen onSignOut={() => setIsLoggedIn(false)} />}
        </Stack.Screen>
      </Stack.Navigator>
    </NavigationContainer>
  );
}
