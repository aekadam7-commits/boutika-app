// يجهّز مشروع أندرويد: Node.js المدمج + إعدادات Capacitor + الخدمة الأمامية + الصلاحيات
// يُشغَّل من CI بعد: npx cap add android && npx cap sync android  (راجع .github/workflows/build-boutika.yml)
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..');
const J = (...p) => path.join(root, ...p);
const read = p => fs.readFileSync(p, 'utf8');
const write = (p, s) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, s); };
const step = process.argv[2];

/* ---- الخطوة 1: قبل cap sync — مشروع Node داخل www/nodejs + إعدادات capacitor ---- */
if (step === 'pre') {
  const tmp = J('.node-build');
  fs.rmSync(tmp, { recursive: true, force: true });
  fs.mkdirSync(tmp, { recursive: true });
  const skip = s => /node_modules|[\\/]nodejs([\\/]|$)/.test(s);
  fs.cpSync(J('www'), path.join(tmp, 'www'), { recursive: true, filter: s => !skip(s) });
  fs.cpSync(J('boutika-server', 'src'), path.join(tmp, 'src'), { recursive: true });
  fs.copyFileSync(J('boutika-server', 'package.json'), path.join(tmp, 'package.json'));
  fs.rmSync(J('www', 'nodejs'), { recursive: true, force: true });
  fs.renameSync(tmp, J('www', 'nodejs'));

  const cfgPath = J('capacitor.config.json');
  const cfg = JSON.parse(read(cfgPath));
  const nodeCfg = { nodeDir: 'nodejs', startMode: 'manual' };
  cfg.plugins = { ...(cfg.plugins || {}), CapacitorNodeJS: nodeCfg, NodeJS: nodeCfg };
  cfg.server = { ...(cfg.server || {}), cleartext: true };
  write(cfgPath, JSON.stringify(cfg, null, 2));
  console.log('✅ pre: nodejs + capacitor.config جاهزان');
}

/* ---- الخطوة 2: بعد cap sync — تعديل مشروع أندرويد ---- */
if (step === 'post') {
  const appId = JSON.parse(read(J('capacitor.config.json'))).appId;       // dz.boutik.v4
  const pkgDir = J('android', 'app', 'src', 'main', 'java', ...appId.split('.'));

  // minSdk 24 مطلوب لـ nodejs-mobile
  const vars = J('android', 'variables.gradle');
  if (fs.existsSync(vars)) write(vars, read(vars).replace(/minSdkVersion\s*=\s*\d+/, 'minSdkVersion = 24'));

  // MainActivity: تسجيل إضافة الخدمة
  write(path.join(pkgDir, 'MainActivity.java'),
`package ${appId};

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
  @Override
  public void onCreate(Bundle savedInstanceState) {
    registerPlugin(BoutikaPlugin.class);
    super.onCreate(savedInstanceState);
  }
}
`);

  write(path.join(pkgDir, 'BoutikaService.java'),
`package ${appId};

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.Service;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.IBinder;

/** خدمة أمامية: تُبقي التطبيق (وبداخله Node.js) حيًّا عند إغلاق الشاشة. */
public class BoutikaService extends Service {
  @Override
  public int onStartCommand(Intent intent, int flags, int startId) {
    String ch = "boutika_server";
    NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
    if (Build.VERSION.SDK_INT >= 26) {
      nm.createNotificationChannel(new NotificationChannel(ch, "Boutika Server", NotificationManager.IMPORTANCE_LOW));
    }
    Notification.Builder b = Build.VERSION.SDK_INT >= 26 ? new Notification.Builder(this, ch) : new Notification.Builder(this);
    b.setContentTitle("Boutika").setContentText("السيرفر يعمل").setSmallIcon(android.R.drawable.stat_notify_sync).setOngoing(true);
    Notification n = b.build();
    if (Build.VERSION.SDK_INT >= 34) startForeground(1, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE);
    else startForeground(1, n);
    return START_STICKY;
  }

  @Override
  public IBinder onBind(Intent intent) { return null; }
}
`);

  write(path.join(pkgDir, 'BoutikaPlugin.java'),
`package ${appId};

import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "BoutikaService")
public class BoutikaPlugin extends Plugin {
  @PluginMethod
  public void start(PluginCall call) {
    if (Build.VERSION.SDK_INT >= 33 && ContextCompat.checkSelfPermission(getContext(), "android.permission.POST_NOTIFICATIONS") != PackageManager.PERMISSION_GRANTED) {
      ActivityCompat.requestPermissions(getActivity(), new String[]{"android.permission.POST_NOTIFICATIONS"}, 77);
    }
    Intent i = new Intent(getContext(), BoutikaService.class);
    if (Build.VERSION.SDK_INT >= 26) getContext().startForegroundService(i); else getContext().startService(i);
    call.resolve();
  }

  @PluginMethod
  public void stop(PluginCall call) {
    getContext().stopService(new Intent(getContext(), BoutikaService.class));
    call.resolve();
  }

  @PluginMethod
  public void ignoreBattery(PluginCall call) {
    Intent i = new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:" + getContext().getPackageName()));
    i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
    getContext().startActivity(i);
    call.resolve();
  }
}
`);

  // AndroidManifest: صلاحيات + الخدمة + http
  const mf = J('android', 'app', 'src', 'main', 'AndroidManifest.xml');
  let m = read(mf);
  const perms = [
    'android.permission.INTERNET', 'android.permission.CAMERA', 'android.permission.ACCESS_NETWORK_STATE',
    'android.permission.FOREGROUND_SERVICE', 'android.permission.FOREGROUND_SERVICE_SPECIAL_USE',
    'android.permission.FOREGROUND_SERVICE_DATA_SYNC', 'android.permission.POST_NOTIFICATIONS',
    'android.permission.WAKE_LOCK', 'android.permission.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS'
  ];
  const addPerms = perms.filter(p => !m.includes('"' + p + '"')).map(p => `    <uses-permission android:name="${p}" />`).join('\n');
  const camFeature = m.includes('android.hardware.camera') ? '' : '\n    <uses-feature android:name="android.hardware.camera" android:required="false" />';
  m = m.replace(/<application/, addPerms + camFeature + '\n\n    <application');
  if (!m.includes('usesCleartextTraffic')) m = m.replace(/<application/, '<application\n        android:usesCleartextTraffic="true"');
  const svc = `        <service android:name=".BoutikaService" android:exported="false" android:foregroundServiceType="specialUse">
            <property android:name="android.app.PROPERTY_SPECIAL_USE_FGS_SUBTYPE" android:value="local-network-server" />
        </service>
`;
  if (!m.includes('.BoutikaService')) m = m.replace('</application>', svc + '    </application>');
  write(mf, m);

  // أيقونة التطبيق
  const icon = J('www', 'icons', 'icon-512.png');
  const res = J('android', 'app', 'src', 'main', 'res');
  if (fs.existsSync(icon) && fs.existsSync(res)) {
    for (const d of fs.readdirSync(res).filter(d => d.startsWith('mipmap-'))) {
      for (const n of ['ic_launcher.png', 'ic_launcher_round.png', 'ic_launcher_foreground.png']) {
        if (fs.existsSync(path.join(res, d, n))) fs.copyFileSync(icon, path.join(res, d, n));
      }
    }
  }
  console.log('✅ post: مشروع أندرويد جاهز');
}
