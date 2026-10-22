# R8 / ProGuard rules for the release build type.
#
# The Flutter embedding and every plugin are reached through the plugin registry or
# through JNI, so R8 cannot see the references from the Dart side.

# Flutter
-keep class io.flutter.** { *; }
-keep class io.flutter.plugins.** { *; }
-keep class io.flutter.app.** { *; }
-keep class io.flutter.plugin.** { *; }
-keep class io.flutter.util.** { *; }
-keep class io.flutter.view.** { *; }
-keep class io.flutter.embedding.** { *; }

# Plugins that are only referenced from Dart
-keep class com.baseflow.** { *; }          # geolocator, permission_handler
-keep class com.dexterous.** { *; }        # flutter_local_notifications
-keep class com.prongbang.** { *; }        # screen_protector
-keep class com.llfbandit.** { *; }        # app_links
-keep class com.it_nomads.** { *; }        # flutter_secure_storage
-keep class io.flutter.plugins.googlemaps.** { *; }
-keep class androidx.camera.** { *; }

# Play Services Maps (admin live map) is reached reflectively
-keep class com.google.android.gms.** { *; }
-keep interface com.google.android.gms.** { *; }
-dontwarn com.google.android.gms.**

# Gson is used for notification payloads and API models
-keep class com.google.gson.** { *; }
-dontwarn com.google.gson.**

-keepattributes Signature
-keepattributes *Annotation*
-dontwarn javax.annotation.**
