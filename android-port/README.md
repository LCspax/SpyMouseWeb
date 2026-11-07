# Spy Mouse · 现代 Android 打包适配

把仓库根目录的 `间谍鼠1.0.7.apk` 与 `com.ea.spymouse_row/files/` 原始数据包，整合成可在较新 Android 上**安装**的重打包产物。这是本机技术研究用的独立目录，**不修改 Web 版任何现有文件**（`src/`、`assets/`、`tools/`、`npm test` 全部不受影响），也不向 git 提交任何原始游戏资源。

> ⚠️ 先读「三条硬约束」和最后的「合规与授权边界」再使用。

---

## 三条硬约束（决定了这套适配的能力上限）

| # | 约束 | 后果 |
|---|---|---|
| 1 | `lib/armeabi/libSpyMouse.so` 是 **2008 年的 ELF32 ARM**（`machine=40`、`flags=0x130014`、老式 `armeabi` ABI），没有源码、没有 64 位版本 | **纯 64 位设备、以及 MuMu 的安卓 15 实例根本无法加载这个库**（后者官方明确不支持 ARM 32 位应用）。重打包解决不了，也**不能转成 64 位**。只能跑在 32 位兼容设备或带 ARM32 翻译的模拟器（安卓 12 实例 / 雷电 5/9）上。安装脚本会做 ABI 预检并拒绝这类目标 |
| 2 | 原 dex 内含 **Google Play LVL 授权校验**（`com.eamobile.licensing.LicenseServerActivity`、内嵌 RSA 公钥、`com.android.vending.CHECK_LICENSE` 权限），而 EA 的下载/授权服务器早已下线 | 重签名会更换证书，授权校验可能失败导致无法进入游戏。**本项目不修改、不禁用、不绕过任何授权代码**，因此无法保证游戏一定能启动 |
| 3 | 这是 EA 的商用游戏 | 仅可用于你**合法持有**副本的本机自用验证；不提供下载、不协助再分发、不生成对外发布的包 |

换句话说：本目录能保证的是**「包结构正确、可安装、数据路径正确、签名合规」**，不能保证**「游戏在新系统上一定跑得起来」**——第 1、2 条不是打包层面的问题。

---

## 错误码 -16 / NO_MATCHING_ABIS（本机 MuMu 15 实测）

在 MuMu 模拟器里安装提示「安装失败，错误码 -16」。已在本机完整复现并定位：

- `-16` 是 AOSP 的 `PackageManager.INSTALL_FAILED_CPU_ABI_INCOMPATIBLE`（"包含的本机代码不兼容 CPU_ABI"）；
- 用 adb 直接安装得到更明确的等价错误：
  ```
  Failure [INSTALL_FAILED_NO_MATCHING_ABIS: Failed to extract native libraries, res=-113]
  ```
- 设备属性（本机 `E:\Program Files\Netease\MuMu`，MuMu 15 / Android 15 / API 35）：
  ```
  ro.product.cpu.abilist                  x86_64,arm64-v8a,x86
  ro.product.cpu.abilist32                x86
  ro.vendor.enable.native.bridge.exec64   1
  ```
  即**只有 64 位 ARM 翻译，完全没有 32 位 ARM ABI**。
- MuMu 官方《MuMu模拟器升级安卓版本注意事项》明写：「**安卓 15 无法使用 ARM 32位架构应用**」，并说明「安卓 15/12 同步运行，灵活选用」。

**结论：这是模拟器实例的限制，不是 APK 打包错误**，改 manifest / 换签名 / 内置数据都救不了。

### 已做的修复（对支持 ARM32 的目标有效）

原包只声明 `lib/armeabi/`，而 `armeabi` 是早已废弃的 ABI，很多带 ARM32 翻译的模拟器只认 `armeabi-v7a`。构建器现在**默认把同一份 `.so` 再复制一份到 `lib/armeabi-v7a/`**（字节完全一致，不是伪造 arm64；可用 `--no-abi-compat` 关闭）。这样在 MuMu 的 Android 12 实例、雷电 5/9、BlueStacks Pie 等目标上能正常安装。

实测：加了 `armeabi-v7a` 后在 MuMu 15 上**仍报同样的 NO_MATCHING_ABIS**（它的 abilist 里连 `armeabi-v7a` 都没有），进一步印证是实例限制。

### 三条可走的路

1. **换 MuMu 的 Android 12 实例（最省事）**：打开 MuMu 多开器 → 新建/切换**安卓 12** 实例（官方支持 12 与 15 共存；若升级时未勾「保留原设备」则需重建一个 12 实例）。本机当前只有 `vms/MuMuPlayer-15.0-0` 一个 Android 15 实例。然后：
   ```powershell
   powershell -NoProfile -ExecutionPolicy Bypass -File android-port\install.ps1 -Diagnose
   powershell -NoProfile -ExecutionPolicy Bypass -File android-port\install.ps1 -Mode full
   ```
   `-Diagnose` 会打印 abilist 并直接判定该实例能不能装，不用等到安装失败。
2. **换支持 ARM32 的模拟器**：雷电 5/9（Android 7/9 + ARM 翻译，本机已装 `Thunder Network\ldplayer`）、BlueStacks Pie 32 位实例，或任意 32 位兼容真机。
3. **用 Web 版**：本仓库 `index.html` + `src/` 是架构无关的 JS 重实现，在 MuMu 自带浏览器里就能跑，完全不依赖这个 `.so`。

---

## 能不能把游戏「转成」64 位 ARM？

**不能，至少不能靠转换。** 逐一说明：

| 想法 | 为什么不行 |
|---|---|
| 把 `.so` 重编译成 `arm64-v8a` | 没有源码。`libSpyMouse.so` 是 2008 年的编译产物，仓库里只有 `analysis/decompiled_*.c` 等**部分函数的反编译片段**，不是完整可重建的工程 |
| 静态二进制翻译 ARM32 → ARM64 | 需要完整控制流恢复（间接跳转、虚表、jump table）、处理 Thumb-2/A32 → AArch64 的寄存器与条件执行差异，以及 JNI / GLES / libc 跨 ABI 边界的结构体布局（指针 4→8 字节）、自修改代码。现有工具（box64、FEX、QEMU user-mode）都不是针对「带 JNI 的 Android 游戏 .so」的可用重编译器 |
| 把 32 位 `.so` 塞进 `lib/arm64-v8a/` 伪装 | 能骗过安装检查（设备 abilist 有 arm64-v8a），但 `dlopen` 会立刻报 `wrong ELF class: ELFCLASS32` 崩溃。**本项目不做这种自欺欺人的产物** |
| 在模拟器里加一个 ARM32 模拟层 | MuMu 15 的 `libnb.so` 只做 64 位翻译，`abilist32=x86` 明说没有 ARM32 通路；塞用户态 qemu/box64 需要 root，性能与 GLES/JNI 桥接均不可控 |

真正「架构无关」的路径本项目其实已经走通：**Web 版用 JS 重写玩法 + 转码后的资源**，不含任何原生二进制，在任何现代浏览器（含模拟器内浏览器）都能运行。若要原生 arm64，等于基于反汇编资料重写整个引擎，是另一个量级的工程。

---

## 原包到底是什么

| 文件 | 实际内容 |
|---|---|
| `间谍鼠1.0.7.apk`（1.5 MB / 43 个文件） | 只是**启动壳**：`classes.dex`（EA 下载器 + LVL 授权）、`lib/armeabi/libSpyMouse.so`、`assets/downloadcontent/` 配置与多语言文案、图标。**不含任何游戏资源** |
| `com.ea.spymouse_row/files/`（178 MB / 5348 文件） | 真正的游戏数据：`res/`（143 个 map 目录、1135 PNG、883 JPG、432 XML、214 MBN、357 SPS 音频…）、`res_960x640/`（高清集，2369 文件 / 80 MB）、`Downloaded.indicate` |

壳里的 `assets/downloadcontent/config.properties` 写着 `DATA_FOLDER=/Android/data/com.ea.spymouse_row/files`，下载 URL 是已失效的 `http://gam.eamobile.com/`。也就是说，原版设计是「装一个小壳 → 联网下载 data.zip → 解压到 SD 卡」。本项目把「联网下载」换成「本地预置」，其余逻辑原样保留。

### 关键路径等式（为什么能零侵入地整合）

逆向 `smali` 后确认：

- `SpyMouseActivity.onCreate()` 把 `DATA_FOLDER` 硬编码为 `/Android/data/<包名>/files`；
- `DownloadActivityInternal.setAssetPath()` 用 `Environment.getExternalStorageDirectory().getAbsolutePath()` 拼上这个值；
- 两者合起来**正好等于** `Context.getExternalFilesDir(null)`——现代 Android 上应用自己的外部私有目录，分区存储下仍可读写、且不需要存储权限；
- `assetsFoundLocally()` 只做一件事：读 `<数据根>/Downloaded.indicate`，判断内容是否含 `COMPLETE`；
- 原始标记内容就是 `COMPLETE\ndata.zip\t1.0.11\n`。

因此只要把数据放到 `getExternalFilesDir(null)` 并保证标记文件存在，下载器就认为「资源已就绪」，直接进入游戏。**不需要改路径常量，不需要改授权，不需要改原生库。**

---

## 适配了什么

| 项 | 原值 | 新值 | 原因 |
|---|---|---|---|
| `targetSdkVersion` | **11** | **28**（可用 `--target-sdk` 调） | Android 14+ 拒装 `targetSdk < 23` 的应用，这是「装不上」的首要原因 |
| 原生库 ABI 声明 | 仅 `lib/armeabi/` | 追加 `lib/armeabi-v7a/`（同一份字节） | `armeabi` 早已废弃，ARM32 翻译环境只在 abilist 里列 `armeabi-v7a`；不加会报 -16 / NO_MATCHING_ABIS |
| `minSdkVersion` | 7 | 7 | 无需改动 |
| 签名 | v1（SignApk，2008 证书） | **v1 + v2** 本地自签 | 现代系统/安装器要求 v2；旧签名在改动后已失效 |
| ZIP 对齐 | — | `zipalign -p 4` | 未压缩资源/`.so` 需要 4 字节对齐 |
| `android:installLocation` | `preferExternal` | 移除 | 现代 Android 已废弃外置安装偏好，大包尤其容易出问题 |
| `<compatible-screens>` | 只列 ldpi~xhdpi | 移除 | 避免高密度/大屏设备被过滤 |
| `android:usesCleartextTraffic` | 无 | `true` | targetSdk 28 起默认禁明文 HTTP，而下载器用 `http://` |
| `<uses-library org.apache.http.legacy>` | 无 | 加入（`required=false`） | dex 使用 `org.apache.http.*`，API 28 起从默认 classpath 移除 |
| `android:requestLegacyExternalStorage` | 无 | `true` | 兼容旧版文件系统访问逻辑 |
| `android:extractNativeLibs` | 无 | `true` | 明确让系统解压 32 位 `.so` |
| 运行时权限 | 安装即授予 | 安装脚本 `adb install -r -g` 预授予 | targetSdk ≥ 23 起 `READ_PHONE_STATE` / `WRITE_EXTERNAL_STORAGE` 需运行时授权 |
| 数据供给 | 联网下载 `data.zip` | 预置 / 内置 | 见下 |

**明确未改动**：`classes.dex` 中的 LVL 授权类与 RSA 公钥、`CHECK_LICENSE` 权限、启动 Activity、原生 `.so`（验证过与根目录 `libSpyMouse.so` 字节一致）、全部原始资源内容。

---

## 两种产物

| 产物 | 体积 | 数据怎么来 | 适用 |
|---|---|---|---|
| `out/spymouse-compat-full.apk` | **170 MiB**（自包含） | 167.5 MiB 数据包以未压缩形式内置于 `assets/spymouse-data.zip`；首次启动由注入的 `DataBootstrap` 解压到 `getExternalFilesDir(null)`，最后写 `Downloaded.indicate` | 「整合到一个 APK」的直接答案；不需要 adb 传数据 |
| `out/spymouse-compat-slim.apk` | **2.8 MiB** | 数据由 `install.ps1 -Mode slim` 单独预置到 `/sdcard/Android/data/com.ea.spymouse_row/files/` | 模拟器 / 已 root 设备；APK 小、无首次解压 |

> 两个 APK 都同时含 `lib/armeabi/` 与 `lib/armeabi-v7a/` 下**同一份** ELF32 ARM `.so`（多出的约 1.3 MiB 就是这份副本）。这是为了匹配只认 `armeabi-v7a` 的 ARM32 翻译环境；它**不能**让 64 位专用目标运行。
| `out/spymouse-data.zip` | 167.5 MiB / 5348 条目 | `Downloaded.indicate` + `res/**` + `res_960x640/**`，全 STORED | 两种模式共用 |

`full` 的注入点只有一行：`SpyMouseActivity.onCreate()` 里 `super.onCreate()` 之后调用 `DataBootstrap.unpack(this)`。`DataBootstrap` 只做解压，不碰授权、不联网、不改任何路径常量。

---

## 构建

需要：Node.js 20+、JDK（提供 `java` / `keytool`）、`apktool.jar`、`apksigner`、`zipalign`。构建器会自动从以下位置找工具，也可用环境变量覆盖：

```
APKTOOL_JAR     APKSIGNER_JAR     ZIPALIGN     JAVA     KEYTOOL
ANDROID_HOME / ANDROID_SDK_ROOT 下的 build-tools/*
本机 HBuilderX: ~/Downloads/HBuilderX/plugins/app-safe-pack/
```

```bash
# 构建两种产物（默认 --mode all）
node android-port/build.mjs --mode all

# 常用参数
node android-port/build.mjs --mode full --target-sdk 27      # 遇到非 SDK 接口限制时可降级
node android-port/build.mjs --apk 自定义.apk --data 自定义数据目录
node android-port/build.mjs --no-abi-compat                  # 不复制 armeabi-v7a（保留原始形态）
node android-port/build.mjs --clean --clean-only             # 清理中间产物

# 静态验证（无需设备）
node android-port/verify.mjs
```

构建流程：反编译 → 改写 manifest / `apktool.yml` → 生成 STORED 数据包 → （full）注入 smali + 内置 assets → `apktool b` → `zipalign -p 4` → apksigner v1+v2 自签 → 输出 `out/build-report.json`。自签密钥 `_work/compat.jks` 只在本机生成，永不提交。

### 验证结果（本机实测）

`node android-port/verify.mjs` **35/35 全部通过**，报告写入 `out/verify-report.json`：

- 两个 APK 的 `apksigner verify`、v1 + v2、`zipalign -c`；
- 反编译回读 manifest：`targetSdkVersion=28`、四项兼容属性、`uses-library`、`compatible-screens` 与 `preferExternal` 已移除、`CHECK_LICENSE` 与启动 Activity 保留；
- APK 内容：32 位 `.so` 存在且与原文件 **SHA-256 完全一致**；两版都声明 `armeabi` + `armeabi-v7a` 且两份**字节一致**（确认没有伪造 arm64）；full 内置 167.5 MiB 数据包且为未压缩 STORED；slim 不含数据包；
- dex 完整性：两版均保留 LVL 授权类；full 含 `DataBootstrap` 与 `SpyMouseCompat`；slim 未被注入；
- 数据包：5348 条目、含 `Downloaded.indicate` / `res/` / `res_960x640/`、标记为 `COMPLETE`、**逐条 CRC 校验 166.8 MiB 全部有效**。

---

## 安装

先连接设备或启动模拟器（`adb devices` 能看到 `device`），然后：

```powershell
# 先体检：打印目标 abilist 并判定能不能装（强烈建议，尤其 MuMu）
powershell -NoProfile -ExecutionPolicy Bypass -File android-port\install.ps1 -Diagnose

# 自包含版（推荐，无额外数据步骤）
powershell -NoProfile -ExecutionPolicy Bypass -File android-port\install.ps1 -Mode full

# 小体积版 + adb 预置数据
powershell -NoProfile -ExecutionPolicy Bypass -File android-port\install.ps1 -Mode slim -Launch

# 指定 adb / 跳过 ABI 预检
powershell -NoProfile -ExecutionPolicy Bypass -File android-port\install.ps1 -Adb "D:\...\adb.exe" -Force
```

脚本会：

1. 自动定位 adb（PATH / 雷电 / MuMu / pcsuite / Android SDK）；
2. **ABI 预检**：读 `ro.product.cpu.abilist` / `abilist32` / `native.bridge.exec64`，只要 abilist 里**没有 `armeabi` 或 `armeabi-v7a` 就直接拒绝**并给出切 Android 12 实例等具体建议（`-Force` 只跳过预检，系统仍会拒装）；脚本会自动从注册表定位 MuMu 自带 adb，并尝试连接 5555/7555/16384；
3. `adb install -r -g` 安装并预授予运行时权限；
4. slim 模式预置数据（设备有 `unzip` 就一次推送 167 MiB；否则 PC 端解压后推送目录树），并校验 `Downloaded.indicate`；
5. 输出首次运行与排查提示。

### 首次运行（full）

解压发生在主线程，167 MiB 顺序写通常 10–60 秒。**可能出现「应用无响应」对话框，选「等待」**。进度日志：

```bash
adb logcat -s SpyMouseCompat
# SpyMouseCompat: unpacking bundled game data (first run, please wait)
# SpyMouseCompat: unpack done
```

标记文件最后写入，所以中途失败下次会自动重试。

### 排查

| 现象 | 可能原因 |
|---|---|
| **错误码 -16** / `INSTALL_FAILED_NO_MATCHING_ABIS` / `CPU_ABI_INCOMPATIBLE` | 目标没有 ARM32 ABI（如 MuMu 安卓 15 实例）。**不是打包问题**，见上文「错误码 -16」章节：换安卓 12 实例 / 雷电 5/9 / 用 Web 版 |
| `INSTALL_FAILED_DEPRECATED_SDK_VERSION` | targetSdk 又被改低了，用 `--target-sdk 28` 重建 |
| 安装后立刻闪退、`dlopen failed` / `is 32-bit instead of 64-bit` | 命中硬约束 #1，换 32 位兼容目标 |
| 卡在授权 / 许可界面 | 命中硬约束 #2，重签名后 LVL 不通过；本项目不提供绕过方案 |
| `NoClassDefFoundError: org/apache/http/...` | manifest 的 `uses-library` 未生效，检查反编译回读结果 |
| targetSdk 28 下报隐藏 API / 非 SDK 接口限制 | 用 `--target-sdk 27` 重建（仍满足 Android 14+ 的 ≥23 门槛） |
| slim 的 `adb push` 到 `/sdcard/Android/data/` 被拒 | Android 11+ 分区存储限制；改用 `-Mode full` |
| full 首次启动 ANR | 属预期，选「等待」；或用 slim + 预置数据 |

---

## 已知限制

- **未在可运行目标上验证游戏本体**：本机只有 MuMu 15（Android 15 / x86_64），已实测 adb 安装并确认返回 `INSTALL_FAILED_NO_MATCHING_ABIS`；静态构建/签名/资源校验 35/35 全过。第 1、2 条硬约束需要在 32 位兼容目标上才能最终确认游戏能否启动；
- `full` 首次解压占用约 167 MiB 额外空间（APK 内 + 释放后），且主线程解压有 ANR 风险；
- `getExternalFilesDir(null)` 在个别多存储设备上可能与硬编码拼接路径不完全一致；
- 老 GLES 1.1 / 已废弃 API 在新驱动上的表现无法静态保证；
- 数据包按原样打包，未做任何格式转换；Web 版仍使用 `assets/` 中已转码的资源，两条链路互不依赖。

---

## 合规与授权边界

- 本目录只是**构建工具与文档**，需要你本机已合法持有原 APK 与数据包才能构建；
- 原始 APK、解包数据、`.so`、生成的 APK/zip/密钥均被 `.gitignore` 排除，**不进入仓库、不随项目分发**；
- 不包含原版游戏源代码，不提供资源下载；
- **不修改、不禁用、不绕过**任何授权 / 购买 / LVL 校验逻辑；
- 产物仅供个人本机技术验证，不得对外发布、分发或商用；权利方有权要求移除；
- 与仓库主 README 的免责声明一致，本项目不保证任何副本、提取物或再分发行为的合法性。

---

## 文件清单

```
android-port/
├─ build.mjs            构建器（反编译 → 改写 → 打包 → 对齐 → 签名）
├─ verify.mjs           静态验证（32 项检查）
├─ install.ps1          adb 安装 / ABI 预检 / 数据预置
├─ DataBootstrap.smali  full 模式的首启解压逻辑（只碰数据路径）
├─ README.md            本文件
├─ .gitignore           忽略 _work/ out/ 密钥
├─ _work/               中间产物（可随时删除）
└─ out/                 交付产物 + build-report.json / verify-report.json
```
