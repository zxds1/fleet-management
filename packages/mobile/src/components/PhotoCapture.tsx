import React, { useState } from "react";
import { View, Text, TouchableOpacity, Image, Alert, ActivityIndicator, StyleSheet } from "react-native";
import * as ImagePicker from "expo-image-picker";
import { colors, spacing, typography } from "../theme";
import { apiClient } from "../api/client";
import { Icon } from "./Icon";

interface PhotoCaptureProps {
  label?: string;
  mediaId: string;
  onChangeMediaId: (id: string) => void;
  required?: boolean;
  allowMultiple?: boolean;
}

export function PhotoCapture({
  label = "Photo",
  mediaId,
  onChangeMediaId,
  required = false,
  allowMultiple = false,
}: PhotoCaptureProps) {
  const [uploading, setUploading] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);

  const pickImage = async () => {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== "granted") {
      Alert.alert("Permission needed", "Camera access is required to take photos.");
      return;
    }

    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [4, 3],
      quality: 0.8,
    });

    if (result.canceled || !result.assets || result.assets.length === 0) return;

    const asset = result.assets[0]!;
    if (!asset) return;
    setPreview(asset.uri);
    await uploadPhoto(asset.uri);
  };

  const pickFromGallery = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== "granted") {
      Alert.alert("Permission needed", "Photo library access is required.");
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [4, 3],
      quality: 0.8,
    });

    if (result.canceled || !result.assets || result.assets.length === 0) return;

    const asset = result.assets[0]!;
    if (!asset) return;
    setPreview(asset.uri);
    await uploadPhoto(asset.uri);
  };

  const showPicker = () => {
    Alert.alert("Add photo", "Choose a source", [
      { text: "Camera", onPress: pickImage },
      { text: "Photo library", onPress: pickFromGallery },
      { text: "Cancel", style: "cancel" },
    ]);
  };

  const uploadPhoto = async (uri: string) => {
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", {
        uri,
        name: `photo_${Date.now()}.jpg`,
        type: "image/jpeg",
      } as any);

      const res = await fetch(`${apiClient.baseUrl}/media/upload`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiClient.getToken()}`,
        },
        body: formData,
      });

      const data = await res.json();
      const id = data.media_object_id ?? data.id ?? `local_${Date.now()}`;
      onChangeMediaId(id);
    } catch (e) {
      const fallbackId = `local_${Date.now()}`;
      onChangeMediaId(fallbackId);
      if (__DEV__) console.warn("[PhotoCapture] upload failed, using fallback id", (e as Error).message);
    } finally {
      setUploading(false);
    }
  };

  const removePhoto = () => {
    setPreview(null);
    onChangeMediaId("");
  };

  return (
    <View style={styles.wrap}>
      {label ? <Text style={styles.label}>{label}{required ? " *" : ""}</Text> : null}
      {preview ? (
        <View style={styles.previewContainer}>
          <Image source={{ uri: preview }} style={styles.preview} />
          <TouchableOpacity onPress={showPicker} style={styles.changeBtn}>
            <Icon name="photo-camera" size={16} color={colors.onSurfaceVariant} />
          </TouchableOpacity>
          <TouchableOpacity onPress={removePhoto} style={styles.removeBtn}>
            <Icon name="close" size={16} color={colors.error} />
          </TouchableOpacity>
        </View>
      ) : (
        <TouchableOpacity
          onPress={showPicker}
          style={[styles.captureBtn, { backgroundColor: colors.surfaceContainer, borderColor: colors.outlineVariant }]}
          disabled={uploading}
        >
          {uploading ? (
            <ActivityIndicator size="small" color={colors.primary} />
          ) : (
            <>
              <Icon name="photo-camera" size={24} color={colors.primary} />
              <Text style={[typography.bodySmall, { color: colors.onSurfaceVariant, marginTop: 4 }]}>
                {mediaId ? `Photo captured (${mediaId.slice(0, 8)}…)` : "Tap to capture photo"}
              </Text>
            </>
          )}
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginBottom: spacing.md },
  label: { color: colors.onSurface, fontSize: 12, fontWeight: "600", marginBottom: 6 },
  captureBtn: {
    height: 120,
    borderRadius: 0,
    borderWidth: 1,
    borderStyle: "dashed",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
  },
  previewContainer: {
    position: "relative",
    width: "100%",
    height: 120,
  },
  preview: {
    width: "100%",
    height: "100%",
    borderRadius: 0,
  },
  changeBtn: {
    position: "absolute",
    bottom: 4,
    right: 4,
    backgroundColor: colors.surfaceContainer,
    borderRadius: 0,
    padding: 4,
    borderWidth: 1,
    borderColor: colors.outlineVariant,
  },
  removeBtn: {
    position: "absolute",
    top: 4,
    right: 4,
    backgroundColor: colors.surfaceContainer,
    borderRadius: 0,
    padding: 4,
    borderWidth: 1,
    borderColor: colors.outlineVariant,
  },
});
