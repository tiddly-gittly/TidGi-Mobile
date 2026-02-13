package expo.modules.externalstorage

import android.os.Build
import android.os.Environment
import android.util.Base64
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File

/**
 * Expo native module that performs raw java.io.File I/O on external storage.
 *
 * Expo's built-in FileSystem module restricts writes to its own directory
 * whitelist, blocking access to shared storage even when MANAGE_EXTERNAL_STORAGE
 * is granted. This module bypasses that restriction.
 *
 * All paths are plain filesystem paths (no file:// prefix).
 */
class ExternalStorageModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("ExternalStorage")

    // --- Basic queries ---

    AsyncFunction("exists") { path: String ->
      File(path).exists()
    }

    AsyncFunction("getInfo") { path: String ->
      val file = File(path)
      if (!file.exists()) {
        return@AsyncFunction mapOf(
          "exists" to false,
          "isDirectory" to false,
          "size" to 0L,
          "modificationTime" to 0L,
        )
      }
      mapOf(
        "exists" to true,
        "isDirectory" to file.isDirectory,
        "size" to file.length(),
        "modificationTime" to file.lastModified(),
      )
    }

    // --- Directory operations ---

    AsyncFunction("mkdir") { path: String ->
      val dir = File(path)
      if (!dir.exists()) {
        val ok = dir.mkdirs()
        if (!ok && !dir.exists()) {
          throw Exception("Failed to create directory: $path")
        }
      }
    }

    AsyncFunction("readDir") { path: String ->
      val dir = File(path)
      if (!dir.exists() || !dir.isDirectory) {
        throw Exception("ENOENT: no such directory: $path")
      }
      dir.list()?.toList() ?: emptyList<String>()
    }

    // Recursively list all files under a directory, returning paths relative to `path`.
    // Skips .git, node_modules, .DS_Store, output directories.
    AsyncFunction("readDirRecursive") { path: String ->
      val root = File(path)
      if (!root.exists() || !root.isDirectory) {
        throw Exception("ENOENT: no such directory: $path")
      }
      val skipNames = setOf(".git", "node_modules", ".DS_Store", "output")
      val result = mutableListOf<String>()
      fun walk(dir: File, prefix: String) {
        val children = dir.listFiles() ?: return
        for (child in children) {
          val relativePath = if (prefix.isEmpty()) child.name else "$prefix/${child.name}"
          if (child.isDirectory) {
            if (child.name !in skipNames) {
              walk(child, relativePath)
            }
          } else {
            result.add(relativePath)
          }
        }
      }
      walk(root, "")
      result
    }

    AsyncFunction("rmdir") { path: String ->
      val dir = File(path)
      if (dir.exists()) {
        dir.deleteRecursively()
      }
    }

    // --- File read/write ---

    AsyncFunction("readFileUtf8") { path: String ->
      val file = File(path)
      if (!file.exists()) {
        throw Exception("ENOENT: no such file: $path")
      }
      file.readText(Charsets.UTF_8)
    }

    AsyncFunction("readFileBase64") { path: String ->
      val file = File(path)
      if (!file.exists()) {
        throw Exception("ENOENT: no such file: $path")
      }
      Base64.encodeToString(file.readBytes(), Base64.NO_WRAP)
    }

    AsyncFunction("writeFileUtf8") { path: String, content: String ->
      val file = File(path)
      file.parentFile?.let { parent ->
        if (!parent.exists()) parent.mkdirs()
      }
      file.writeText(content, Charsets.UTF_8)
    }

    AsyncFunction("writeFileBase64") { path: String, base64Content: String ->
      val file = File(path)
      file.parentFile?.let { parent ->
        if (!parent.exists()) parent.mkdirs()
      }
      val bytes = Base64.decode(base64Content, Base64.DEFAULT)
      file.writeBytes(bytes)
    }

    AsyncFunction("deleteFile") { path: String ->
      val file = File(path)
      if (file.exists()) {
        file.delete()
      }
    }

    // --- Helper: check if external storage is available and MANAGE permission effective ---

    AsyncFunction("isExternalStorageWritable") {
      Environment.getExternalStorageState() == Environment.MEDIA_MOUNTED
    }

    AsyncFunction("getExternalStorageDirectory") {
      Environment.getExternalStorageDirectory()?.absolutePath ?: ""
    }

    /**
     * Check if this app has MANAGE_EXTERNAL_STORAGE ("All files access") granted.
     * On Android < 11 (API 30), returns true (not needed).
     */
    AsyncFunction("isExternalStorageManager") {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
        Environment.isExternalStorageManager()
      } else {
        true
      }
    }
  }
}
