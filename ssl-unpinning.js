// Frida script to bypass common Android SSL pinning implementations.
// Usage: frida -U -f <package.name> -l ssl-unpinning.js --no-pause
// Covers: OkHttp CertificatePinner, TrustManagerImpl, Conscrypt, and
// javax.net.ssl default TrustManagers. Test coverage varies per app.

Java.perform(function () {
    console.log("[*] SSL unpinning started");

    // --- OkHttp3 CertificatePinner: neutralize all pin checks ---
    try {
        var CertificatePinner = Java.use("okhttp3.CertificatePinner");
        CertificatePinner.check.overload(
            "java.lang.String", "java.util.List"
        ).implementation = function () {
            console.log("[+] Bypassed OkHttp3 CertificatePinner.check");
        };
    } catch (e) { console.log("[-] OkHttp3 CertificatePinner not found"); }

    // --- Conscrypt / platform TrustManagerImpl: trust everything ---
    try {
        var TrustManagerImpl = Java.use(
            "com.android.org.conscrypt.TrustManagerImpl"
        );
        TrustManagerImpl.verifyChain.implementation = function (untrustedChain,
            trustAnchorChain, host, clientAuth, ocspData, tlsSctData) {
            console.log("[+] Bypassed TrustManagerImpl for: " + host);
            return untrustedChain;
        };
    } catch (e) { console.log("[-] TrustManagerImpl not found"); }

    // --- Default X509TrustManager: never throw on server checks ---
    try {
        var X509TrustManager = Java.use("javax.net.ssl.X509TrustManager");
        var SSLContext = Java.use("javax.net.ssl.SSLContext");
        var TrustManager = Java.registerClass({
            name: "dev.mitm.TrustAllManager",
            implements: [X509TrustManager],
            methods: {
                checkClientTrusted: function () {},
                checkServerTrusted: function () {},
                getAcceptedIssuers: function () { return []; },
            },
        });
        SSLContext.init.overload(
            "[Ljavax.net.ssl.KeyManager;",
            "[Ljavax.net.ssl.TrustManager;",
            "java.security.SecureRandom"
        ).implementation = function (km, tm, sr) {
            console.log("[+] Replaced TrustManagers with TrustAllManager");
            SSLContext.init.call(this, km, [TrustManager.$new()], sr);
        };
    } catch (e) { console.log("[-] SSLContext hook failed: " + e); }

    // --- HostnameVerifier: accept any hostname ---
    try {
        var HostnameVerifier = Java.use("javax.net.ssl.HostnameVerifier");
        var HttpsURLConnection = Java.use("javax.net.ssl.HttpsURLConnection");
        HttpsURLConnection.setDefaultHostnameVerifier(
            HostnameVerifier.implement({
                verify: function () {
                    console.log("[+] Bypassed HostnameVerifier");
                    return true;
                },
            })
        );
    } catch (e) { console.log("[-] HostnameVerifier hook failed: " + e); }
});
