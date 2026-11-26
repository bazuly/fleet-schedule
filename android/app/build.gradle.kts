plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "pro.grando.fleet"
    compileSdk = 35

    defaultConfig {
        applicationId = "pro.grando.fleet"
        minSdk = 26
        targetSdk = 35
        versionCode = 5
        versionName = "1.0.4"
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            signingConfig = signingConfigs.getByName("debug")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

kotlin {
    jvmToolchain(17)
}
