package pro.grando.fleet

import android.annotation.SuppressLint
import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.view.View
import android.webkit.CookieManager
import android.webkit.JavascriptInterface
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.EditText
import android.widget.ProgressBar
import android.widget.Toast

class MainActivity : Activity() {
    private lateinit var web: WebView
    private lateinit var setup: View
    private lateinit var progress: ProgressBar
    private lateinit var address: EditText

    private val prefs by lazy { getSharedPreferences(PREFS, MODE_PRIVATE) }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        if (Build.VERSION.SDK_INT >= 35) {
            @Suppress("DEPRECATION")
            window.setDecorFitsSystemWindows(true)
        }
        setContentView(R.layout.activity_main)

        web = findViewById(R.id.web)
        setup = findViewById(R.id.setup)
        progress = findViewById(R.id.progress)
        address = findViewById(R.id.address)

        web.settings.javaScriptEnabled = true
        web.settings.domStorageEnabled = true
        web.settings.databaseEnabled = true
        web.settings.useWideViewPort = true
        web.settings.loadWithOverviewMode = false
        // Прошлая установка сохранила предупреждение ngrok вместо CSS и скриптов.
        web.clearCache(true)
        web.settings.cacheMode = android.webkit.WebSettings.LOAD_NO_CACHE
        web.settings.setSupportZoom(false)
        web.settings.builtInZoomControls = false
        web.settings.displayZoomControls = false
        // Иначе WebView держит буквы не меньше 8px, и при отдалении подпись не влезает в клетку.
        web.settings.textZoom = 100
        web.settings.minimumFontSize = 1
        web.settings.minimumLogicalFontSize = 1
        web.settings.mediaPlaybackRequiresUserGesture = true
        web.settings.allowFileAccess = false
        // В User-Agent нет «Mozilla»: иначе ngrok отдаёт страницу-предупреждение вместо CSS и скриптов.
        web.settings.userAgentString = "FleetScheduleAndroid/1.0"
        CookieManager.getInstance().setAcceptCookie(true)
        CookieManager.getInstance().setAcceptThirdPartyCookies(web, true)
        web.addJavascriptInterface(Bridge(), "FleetApp")
        web.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                val scheme = request.url.scheme
                if (scheme == "http" || scheme == "https") return false
                startActivity(Intent(Intent.ACTION_VIEW, request.url))
                return true
            }

            override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
                if (!request.isForMainFrame) return
                Toast.makeText(this@MainActivity, R.string.load_failed, Toast.LENGTH_LONG).show()
                showSetup()
            }
        }
        web.webChromeClient = object : WebChromeClient() {
            override fun onProgressChanged(view: WebView?, newProgress: Int) {
                progress.visibility = if (newProgress in 1..99 && setup.visibility != View.VISIBLE) View.VISIBLE else View.GONE
            }
        }

        findViewById<Button>(R.id.open).setOnClickListener {
            open(address.text?.toString().orEmpty())
        }

        val saved = prefs.getString(KEY_URL, null)
        if (saved.isNullOrBlank()) showSetup() else open(saved)
    }

    override fun onBackPressed() {
        if (setup.visibility == View.VISIBLE) {
            val saved = prefs.getString(KEY_URL, null)
            if (!saved.isNullOrBlank() && web.url != null) {
                setup.visibility = View.GONE
                return
            }
            super.onBackPressed()
            return
        }
        if (web.canGoBack()) web.goBack() else super.onBackPressed()
    }

    private fun showSetup() {
        address.setText(prefs.getString(KEY_URL, "") ?: "")
        address.setSelection(address.text?.length ?: 0)
        setup.visibility = View.VISIBLE
        progress.visibility = View.GONE
    }

    private fun open(raw: String) {
        val url = normalize(raw)
        if (url == null) {
            Toast.makeText(this, R.string.bad_address, Toast.LENGTH_SHORT).show()
            showSetup()
            return
        }
        prefs.edit().putString(KEY_URL, url).apply()
        setup.visibility = View.GONE
        progress.visibility = View.VISIBLE
        web.loadUrl(url, mapOf("ngrok-skip-browser-warning" to "1"))
    }

    private inner class Bridge {
        @JavascriptInterface
        fun openSetup() {
            runOnUiThread { showSetup() }
        }
    }

    companion object {
        private const val PREFS = "fleet"
        private const val KEY_URL = "url"

        fun normalize(raw: String): String? {
            var value = raw.trim()
            if (value.isEmpty()) return null
            if (!value.startsWith("http://") && !value.startsWith("https://")) value = "https://$value"
            return try {
                val uri = Uri.parse(value)
                if (uri.host.isNullOrBlank()) null else value.trimEnd('/')
            } catch (_: Exception) {
                null
            }
        }
    }
}
