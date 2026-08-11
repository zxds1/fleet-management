// packages/mobile/src/design/components/BottomSheet.tsx
import React from "react";
import { View, Modal, TouchableWithoutFeedback } from "react-native";
import { theme } from "../theme";
import { Text } from "./Text";

export interface BottomSheetProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
  /** Tablet (admin) uses a centered dialog instead of a sheet. */
  centered?: boolean;
}

/** Carbon-style bottom sheet / modal. Square corners, 48px tap targets, full-bleed on phone. */
export function BottomSheet({ open, onClose, title, children, centered }: BottomSheetProps) {
  if (!open) return null;
  return (
    <Modal visible={open} transparent animationType="slide" onRequestClose={onClose}>
      <TouchableWithoutFeedback onPress={onClose}>
        <View style={{ flex: 1, backgroundColor: theme.colors.scrim, justifyContent: centered ? "center" : "flex-end" }} />
      </TouchableWithoutFeedback>
      <View
        style={[
          {
            backgroundColor: theme.colors.ui01,
            borderTopLeftRadius: centered ? theme.radius.md : 0,
            borderTopRightRadius: centered ? theme.radius.md : 0,
            padding: theme.spacing[5],
            maxHeight: "90%",
          },
          centered && { margin: theme.spacing[5], borderRadius: theme.radius.md },
        ]}
      >
        {title && (
          <View style={{ marginBottom: theme.spacing[4] }}>
            <Text title={title} preset="heading02" />
          </View>
        )}
        {children}
      </View>
    </Modal>
  );
}
