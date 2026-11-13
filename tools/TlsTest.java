import javax.net.ssl.HttpsURLConnection;
import java.net.URL;

public class TlsTest {
    public static void main(String[] args) throws Exception {
        String target = args.length > 0 ? args[0] : "https://example.com/";
        System.out.println("Requesting: " + target);
        try {
            HttpsURLConnection c = (HttpsURLConnection) new URL(target).openConnection();
            c.setConnectTimeout(10000);
            c.setReadTimeout(10000);
            int code = c.getResponseCode();
            String cipher = c.getCipherSuite();
            System.out.println("HTTP " + code);
            System.out.println("Cipher: " + cipher);
            for (java.security.cert.Certificate cert : c.getServerCertificates()) {
                System.out.println("Peer cert: " + ((java.security.cert.X509Certificate) cert).getSubjectX500Principal());
            }
            System.out.println("TLS-OK");
        } catch (Exception e) {
            System.out.println("TLS-FAIL: " + e);
        }
    }
}
