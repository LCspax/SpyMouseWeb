# DataBootstrap -- first-run extraction of the bundled game data pack.
#
# Injected into SpyMouseActivity.onCreate() by build.mjs (--mode full/all).
# It deliberately touches ONLY the data-provisioning path:
#   * target directory = Context.getExternalFilesDir(null)
#     = Environment.getExternalStorageDirectory() + "/Android/data/<pkg>/files"
#     = the exact path DownloadActivityInternal.setAssetPath() and
#       SpyMouseActivity.DATA_FOLDER already use. No path constants are changed.
#   * completion marker = Downloaded.indicate containing "COMPLETE", which is
#     exactly what DownloadActivityInternal.assetsFoundLocally() checks.
# No licensing / LVL / purchase code is referenced or modified.

.class public Lcom/ea/spymouse_na/DataBootstrap;
.super Ljava/lang/Object;
.source "DataBootstrap.java"


# direct methods
.method public constructor <init>()V
    .locals 0

    invoke-direct {p0}, Ljava/lang/Object;-><init>()V

    return-void
.end method


.method public static unpack(Landroid/content/Context;)V
    .locals 12

    :try_start_0
    # ---- root = context.getExternalFilesDir(null) ----
    const/4 v0, 0x0

    invoke-virtual {p0, v0}, Landroid/content/Context;->getExternalFilesDir(Ljava/lang/String;)Ljava/io/File;

    move-result-object v0

    if-eqz v0, :cond_root_ready

    return-void

    :cond_root_ready
    # ---- marker = new File(root, "Downloaded.indicate") ----
    new-instance v1, Ljava/io/File;

    const-string v2, "Downloaded.indicate"

    invoke-direct {v1, v0, v2}, Ljava/io/File;-><init>(Ljava/io/File;Ljava/lang/String;)V

    # Already provisioned (either by a previous run or by adb push): do nothing.
    invoke-virtual {v1}, Ljava/io/File;->exists()Z

    move-result v2

    if-eqz v2, :cond_need_unpack

    return-void

    :cond_need_unpack
    const-string v2, "SpyMouseCompat"

    const-string v3, "unpacking bundled game data (first run, please wait)"

    invoke-static {v2, v3}, Landroid/util/Log;->i(Ljava/lang/String;Ljava/lang/String;)I

    # ---- zis = new ZipInputStream(new BufferedInputStream(assets.open(...))) ----
    invoke-virtual {p0}, Landroid/content/Context;->getAssets()Landroid/content/res/AssetManager;

    move-result-object v2

    const-string v3, "spymouse-data.zip"

    invoke-virtual {v2, v3}, Landroid/content/res/AssetManager;->open(Ljava/lang/String;)Ljava/io/InputStream;

    move-result-object v2

    new-instance v3, Ljava/io/BufferedInputStream;

    invoke-direct {v3, v2}, Ljava/io/BufferedInputStream;-><init>(Ljava/io/InputStream;)V

    new-instance v2, Ljava/util/zip/ZipInputStream;

    invoke-direct {v2, v3}, Ljava/util/zip/ZipInputStream;-><init>(Ljava/io/InputStream;)V

    # ---- buf = new byte[65536] ----
    const v3, 0x10000

    new-array v4, v3, [B

    :loop_entry
    invoke-virtual {v2}, Ljava/util/zip/ZipInputStream;->getNextEntry()Ljava/util/zip/ZipEntry;

    move-result-object v5

    if-eqz v5, :cond_unpack_done

    # ---- out = new File(root, entry.getName()) ----
    new-instance v6, Ljava/io/File;

    invoke-virtual {v5}, Ljava/util/zip/ZipEntry;->getName()Ljava/lang/String;

    move-result-object v7

    invoke-direct {v6, v0, v7}, Ljava/io/File;-><init>(Ljava/io/File;Ljava/lang/String;)V

    invoke-virtual {v5}, Ljava/util/zip/ZipEntry;->isDirectory()Z

    move-result v7

    if-eqz v7, :cond_regular_file

    invoke-virtual {v6}, Ljava/io/File;->mkdirs()Z

    goto :loop_next_entry

    :cond_regular_file
    invoke-virtual {v6}, Ljava/io/File;->getParentFile()Ljava/io/File;

    move-result-object v7

    if-eqz v7, :cond_parent_ready

    invoke-virtual {v7}, Ljava/io/File;->mkdirs()Z

    :cond_parent_ready
    new-instance v7, Ljava/io/FileOutputStream;

    invoke-direct {v7, v6}, Ljava/io/FileOutputStream;-><init>(Ljava/io/File;)V

    :loop_read
    invoke-virtual {v2, v4}, Ljava/io/InputStream;->read([B)I

    move-result v8

    if-lez v8, :cond_write_done

    const/4 v9, 0x0

    invoke-virtual {v7, v4, v9, v8}, Ljava/io/OutputStream;->write([BII)V

    goto :loop_read

    :cond_write_done
    invoke-virtual {v7}, Ljava/io/OutputStream;->close()V

    :loop_next_entry
    invoke-virtual {v2}, Ljava/util/zip/ZipInputStream;->closeEntry()V

    goto :loop_entry

    :cond_unpack_done
    invoke-virtual {v2}, Ljava/io/InputStream;->close()V

    # ---- write the completion marker LAST (so an interrupted run retries) ----
    new-instance v2, Ljava/io/FileOutputStream;

    invoke-direct {v2, v1}, Ljava/io/FileOutputStream;-><init>(Ljava/io/File;)V

    const-string v3, "COMPLETE\ndata.zip\t1.0.11\n"

    invoke-virtual {v3}, Ljava/lang/String;->getBytes()[B

    move-result-object v3

    invoke-virtual {v2, v3}, Ljava/io/OutputStream;->write([B)V

    invoke-virtual {v2}, Ljava/io/OutputStream;->close()V

    const-string v2, "SpyMouseCompat"

    const-string v3, "unpack done"

    invoke-static {v2, v3}, Landroid/util/Log;->i(Ljava/lang/String;Ljava/lang/String;)I
    :try_end_0
    .catch Ljava/lang/Throwable; {:try_start_0 .. :try_end_0} :catch_all

    return-void

    :catch_all
    move-exception v0

    const-string v1, "SpyMouseCompat"

    const-string v2, "unpack failed"

    invoke-static {v1, v2, v0}, Landroid/util/Log;->e(Ljava/lang/String;Ljava/lang/String;Ljava/lang/Throwable;)I

    return-void
.end method
