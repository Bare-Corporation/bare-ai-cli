/*
 * NiFi Groovy Script: Fetch NiFi JWT Token (v1.0)
 * Calls POST /nifi-api/access/token with credentials and returns JWT token.
 * Sets attribute: nifi.fetched.token
 * Reads attributes: nifi.api.base_url, nifi.admin.user, nifi.admin.password, nifi.api.ssl.verify
 */
import java.net.HttpURLConnection
import java.net.URL
import javax.net.ssl.HttpsURLConnection
import javax.net.ssl.SSLContext
import javax.net.ssl.TrustManager
import javax.net.ssl.X509TrustManager
import java.security.cert.X509Certificate

def REL_SUCCESS = context.getAvailableRelationships().find { it.name == 'success' }
def REL_FAILURE = context.getAvailableRelationships().find { it.name == 'failure' }

def flowFile = session.get()
if (!flowFile) return

try {
    def nifiBaseUrl = flowFile.getAttribute('nifi.api.base_url')
    def username    = flowFile.getAttribute('nifi.admin.user')
    def password    = flowFile.getAttribute('nifi.admin.password')
    def sslVerify   = Boolean.parseBoolean(flowFile.getAttribute('nifi.api.ssl.verify') ?: 'false')

    if (!nifiBaseUrl || !username || !password) {
        throw new Exception("Missing required attributes: nifi.api.base_url, nifi.admin.user, nifi.admin.password")
    }

    if (!sslVerify) {
        def trustAll = [
            checkClientTrusted: { chain, authType -> },
            checkServerTrusted: { chain, authType -> },
            getAcceptedIssuers: { [] as X509Certificate[] }
        ] as X509TrustManager
        def sslCtx = SSLContext.getInstance("TLS")
        sslCtx.init(null, [trustAll] as TrustManager[], null)
        HttpsURLConnection.setDefaultSSLSocketFactory(sslCtx.getSocketFactory())
        HttpsURLConnection.setDefaultHostnameVerifier({ host, sess -> true })
    }

    def cleanBase = nifiBaseUrl.endsWith("/") ? nifiBaseUrl.substring(0, nifiBaseUrl.length() - 1) : nifiBaseUrl
    def tokenUrl  = "${cleanBase}/access/token"
    def postData  = "username=${URLEncoder.encode(username, 'UTF-8')}&password=${URLEncoder.encode(password, 'UTF-8')}"

    def url = new URL(tokenUrl)
    def connection = url.openConnection() as HttpURLConnection
    connection.setRequestMethod("POST")
    connection.setRequestProperty("Content-Type", "application/x-www-form-urlencoded")
    connection.setDoOutput(true)
    connection.setConnectTimeout(10000)
    connection.setReadTimeout(10000)

    connection.outputStream.withWriter("UTF-8") { it.write(postData) }

    def responseCode = connection.responseCode
    def token = ""

    if (responseCode == 201 || responseCode == 200) {
        token = connection.inputStream.text?.trim()
    } else {
        def errBody = connection.errorStream?.text ?: "No error body"
        throw new Exception("Token fetch failed. HTTP ${responseCode}: ${errBody}")
    }

    if (!token || token.isEmpty()) {
        throw new Exception("Token fetch returned empty response")
    }

    flowFile = session.putAttribute(flowFile, 'nifi.fetched.token', token)
    log.info("NiFi JWT token fetched successfully")
    session.transfer(flowFile, REL_SUCCESS)

} catch (Exception e) {
    log.error("Token fetch error: ${e.getMessage()}", e)
    flowFile = session.putAttribute(flowFile, 'error.reason', e.getMessage())
    session.transfer(flowFile, REL_FAILURE)
}
