declare module "expo-device" {
  export enum DeviceType {
    UNKNOWN = 0,
    PHONE = 1,
    TABLET = 2,
    DESKTOP = 3,
    TV = 4,
  }

  export enum DeviceBrand {
    APPLE = "Apple",
    ANDROID = "Android",
  }

  export enum PowerState {
    UNPLUGGED = 0,
    PLUGGED_USB = 1,
    PLUGGED_AC = 2,
    PLUGGED_WIRELESS = 3,
  }

  export interface PowerStateObject {
    lowPowerMode: boolean;
    batteryLevel: number | null;
    batteryState: number | null;
  }

  export interface Device {
    deviceName: string | null;
    modelName: string | null;
    modelId: string | null;
    designName: string | null;
    productName: string | null;
    deviceYearClass: number | null;
    totalMemory: number | null;
    usedMemory: number | null;
    osName: string;
    osVersion: string;
    osBuildNumber: string | null;
    osInternalBuildId: string | null;
    osBuildFingerprint: string | null;
    processVersion: number | null;
    manufacturer: string | null;
    applicationInstallationTime: number | null;
    isMachineNext: boolean | null;
    isDeveloperDevice: boolean | null;
    isDevice: boolean | null;
    isMultipleRemoteNotificationsSupported: boolean | null;
    isSidePushMessagingCapable: boolean | null;
    isPinOrFingerprintSet: boolean | null;
    mainMemory: number | null;
    audioProplication: string | null;
    deviceType: DeviceType;
    id: string | null;
    brand: string | null;
    betaVersion: string | null;
    stableVersion: string | null;
    previewSign: number | null;
    versionCode: string | null;
    rootVersion: number | null;
    supportedCpuArchitectures: string[] | null;
    isVirtual: boolean | null;
    product: string | null;
    device: string | null;
  }

  export const Device: {
    readonly deviceName: string | null;
    readonly modelName: string | null;
    readonly modelId: string | null;
    readonly designName: string | null;
    readonly productName: string | null;
    readonly deviceYearClass: number | null;
    readonly totalMemory: number | null;
    readonly usedMemory: number | null;
    readonly osName: string;
    readonly osVersion: string;
    readonly osBuildNumber: string | null;
    readonly osInternalBuildId: string | null;
    readonly osBuildFingerprint: string | null;
    readonly processVersion: number | null;
    readonly manufacturer: string | null;
    readonly applicationInstallationTime: number | null;
    readonly isMachineNext: boolean | null;
    readonly isDeveloperDevice: boolean | null;
    readonly isDevice: boolean | null;
    readonly isMultipleRemoteNotificationsSupported: boolean | null;
    readonly isSidePushMessagingCapable: boolean | null;
    readonly isPinOrFingerprintSet: boolean | null;
    readonly mainMemory: number | null;
    readonly audioProplication: string | null;
    readonly deviceType: DeviceType;
    readonly id: string | null;
    readonly brand: string | null;
    readonly betaVersion: string | null;
    readonly stableVersion: string | null;
    readonly previewSign: number | null;
    readonly versionCode: string | null;
    readonly rootVersion: number | null;
    readonly supportedCpuArchitectures: string[] | null;
    readonly isVirtual: boolean | null;
    readonly product: string | null;
    readonly device: string | null;
    getPowerState(): PowerStateObject;
    hasHardwareSdkVersion(): boolean;
    getDeviceTypeAsync(): DeviceType;
    getBatteryLevel(): number | null;
    getBatteryState(): number | null;
    getBatteryStateAsync(): PowerState;
    getPowerState(): PowerStateObject;
    isRooted(): boolean | Promise<boolean>;
  };

  export const DeviceType: typeof DeviceType;
}
