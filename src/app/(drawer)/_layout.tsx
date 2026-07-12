import { Drawer } from 'expo-router/drawer';
import { Sidebar } from '@/components/Sidebar';
import { colors } from '@/lib/theme';

// 왼쪽 엣지 스와이프로 열고, 옆으로 스와이프하거나 바깥을 탭하면 닫힌다
export default function DrawerLayout() {
  return (
    <Drawer
      drawerContent={(props) => <Sidebar {...props} />}
      screenOptions={{
        headerShown: false,
        drawerType: 'front',
        swipeEdgeWidth: 100,
        overlayColor: 'rgba(0,0,0,0.55)',
        drawerStyle: {
          backgroundColor: colors.canvas,
          width: 300,
          borderRightColor: colors.hairline,
          borderRightWidth: 1,
        },
        sceneStyle: { backgroundColor: colors.canvas },
      }}
    >
      <Drawer.Screen name="index" />
    </Drawer>
  );
}
