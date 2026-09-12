import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.CodeSigner;
import java.security.MessageDigest;
import java.security.cert.CertificateFactory;
import java.security.cert.X509Certificate;
import java.util.HashSet;
import java.util.Locale;
import java.util.Set;
import java.util.jar.JarEntry;
import java.util.jar.JarFile;

/** Verify every bundle payload entry against the intended upload certificate. */
public class VerifyUploadBundle {
    public static void main(String[] args) throws Exception {
        if (args.length != 2) throw new IllegalArgumentException("Expected bundle and certificate paths");
        X509Certificate expected;
        try (InputStream input = Files.newInputStream(Path.of(args[1]))) {
            expected = (X509Certificate) CertificateFactory.getInstance("X.509").generateCertificate(input);
        }
        expected.checkValidity();
        byte[] fingerprint = MessageDigest.getInstance("SHA-256").digest(expected.getEncoded());
        Set<String> names = new HashSet<>();
        int payloads = 0;
        try (JarFile bundle = new JarFile(args[0], true)) {
            var entries = bundle.entries();
            while (entries.hasMoreElements()) {
                JarEntry entry = entries.nextElement();
                if (!names.add(entry.getName())) throw new SecurityException("Duplicate bundle entry");
                if (entry.isDirectory()) continue;
                String name = entry.getName().toUpperCase(Locale.ROOT);
                if (name.equals("META-INF/MANIFEST.MF") ||
                    name.matches("META-INF/[^/]+\\.(SF|RSA|DSA|EC)") ||
                    name.matches("META-INF/SIG-[^/]+")) continue;
                // Reading all bytes triggers the JDK's actual signature/digest validation.
                try (InputStream input = bundle.getInputStream(entry)) {
                    input.transferTo(java.io.OutputStream.nullOutputStream());
                }
                CodeSigner[] signers = entry.getCodeSigners();
                if (signers == null || signers.length != 1) throw new SecurityException("Unsigned or multiply signed bundle entry");
                byte[] signer = MessageDigest.getInstance("SHA-256").digest(
                    signers[0].getSignerCertPath().getCertificates().get(0).getEncoded());
                if (!MessageDigest.isEqual(fingerprint, signer)) throw new SecurityException("Unexpected upload certificate");
                payloads++;
            }
        }
        if (payloads == 0 || !names.contains("BundleConfig.pb") ||
            !names.contains("base/manifest/AndroidManifest.xml")) throw new SecurityException("Missing bundle payload");
        System.out.println("Verified all bundle payload signatures against the intended upload certificate");
    }
}
