# llm-bridge

[![CI](https://github.com/YusufBeratZengin/llm-bridge/actions/workflows/ci.yml/badge.svg)](https://github.com/YusufBeratZengin/llm-bridge/actions/workflows/ci.yml) [![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE) [![Node.js](https://img.shields.io/badge/node-%3E%3D20-green.svg)](package.json)

Bir kodlama ajanından diğerine görev aktarmak için tek komut satırı aracı ve küçük bir Node kütüphanesi. Farklı CLI ve HTTP servislerini ortak bir arayüzde toplar; gönderilecek metni tarar, süre sınırı uygular, içeriği gizlenmiş JSONL kayıtları tutar ve istenirse kota veya zaman aşımı hatasında sıradaki sağlayıcıya geçer.

[English](README.md) · MIT · Node.js 20 ve üzeri · ESM · Çalışma anında ek bağımlılık yok

Kaynak depodan `npm install -g . --omit=dev --ignore-scripts` ile kurun; üretimden önce `llm-bridge ask --dry-run "hi"` ile planı inceleyin. Çalışma anında ek bağımlılık gerekmez.

## Hızlı demo

Aşağıdaki çıktılar yerel çalıştırmalardan alındı. Doctor çıktısı kısıtlı bir Windows sandbox'ına ait: kurulu CLI'lar alt süreç başlatamadı, yerel HTTP servisine de ulaşılamadı. Çıktıdan hassas alan silinmedi; doctor zaten bu tür alanlar üretmez.

```console
$ llm-bridge providers
codex-cli
claude-code
ollama
openai-compatible
$ llm-bridge doctor --json
{"providers":[{"name":"codex-cli","installed":true,"auth":"unknown","errorKind":"nonzero_exit"},{"name":"claude-code","installed":true,"auth":"unknown","errorKind":"nonzero_exit"},{"name":"ollama","installed":false,"auth":"unknown","errorKind":"nonzero_exit"},{"name":"openai-compatible","installed":false,"auth":"unknown","errorKind":"not_installed"}]}
```

Sahte anahtar, parçalar birleştirilerek oluşturulur ve stdin üzerinden verilir (PowerShell):

```powershell
$demoKey = 'sk-' + ('F' * 24)
$demoKey | llm-bridge ask --provider codex --log-dir is/demo-logs --json --prompt -
Write-Output "exit code: $LASTEXITCODE"
```

```text
{"text":"","provider":"","errorKind":"privacy_gate","exitCode":3,"message":"Privacy gate blocked the request. Remove sensitive data or configure an exact allowlist entry.","findings":[{"kind":"api_key","source":"prompt","line":1,"column":1}],"outputPath":null}
exit code: 3
```

```console
$ llm-bridge ask --provider codex --dry-run --log-dir is/demo-logs --file src/gate.mjs hi
{"provider":"codex-cli","providers":["codex-cli"],"mode":"ask","timeoutMs":120000,"totalTimeoutMs":null,"attachments":[{"label":"attachment:1","chars":5689}],"detection":{"installed":true,"auth":"unknown","errorKind":"nonzero_exit"}}
```

Başarılı akışı tekrarlamak için deponun kökünde `node examples/fake-demo.mjs` çalıştırın. Betik `is/demo` içinde depodaki **sahte çalıştırılabilir dosyayı** ayarlar; model çağırmaz. Sağlayıcı listesi, doctor, dry-run, gate engeli ve `llm-bridge ask --out answer.txt hi` adımlarını çalıştırır. Yanıt dosyasına sahte cevap yazılır; stdout sonunda `LLM_BRIDGE_OUTPUT` (JSON biçiminde tam dosya yolu), `LLM_BRIDGE_PROVIDER=codex-cli` ve `LLM_BRIDGE_ERROR=` satırları bulunur. Sandbox alt süreç oluşturmaya `EPERM` verdiği için başarı çıktısı burada kaydedilemedi; demoyu normal terminalde doğrulayın. [examples/](examples/) klasörüne bakın.

## Kaynaktan kurulum

```sh
npm ci
node bin/llm-bridge.mjs --help
npm install -g . --omit=dev --ignore-scripts
```

Paketin ve komutun adı `llm-bridge`. Bu depo, paketin npm'de yayımlandığını varsaymaz. Kullanacağınız ajanı ayrıca kurup kendi hesabınızla giriş yapın. Model çağrıları ücret veya kota tüketebilir; llm-bridge maliyet hesaplamaz ve harcama onayı vermez.

## Akış

```mermaid
flowchart TD
    A[Ana kodlama ajanı] --> B[CLI veya delegate kütüphanesi]
    B --> C[Prompt, metin ekleri, git diff]
    C --> D{Gizlilik ve sır kontrolü}
    D -->|Bulgu var| E[Konumları bildir; çıkış 3; gönderme]
    D -->|Temiz| F[Sağlayıcıyı süre sınırıyla çalıştır]
    F --> G{Sonuç}
    G -->|Kota veya zaman aşımı| H[Belirtilen sonraki sağlayıcı]
    H --> F
    G -->|Başarı veya başka hata| I[Metin ve son satırlar ya da tek JSON]
    F --> J[Geçici klasörde içeriği gizlenmiş JSONL]
```

## Kullanım

Claude Code içinden Codex'e ikinci görüş sordurmak için, Claude Code'a ilgili depoda şu komutu çalıştırmasını söyleyin:

```sh
llm-bridge ask --provider codex --file src/gate.mjs --dry-run \
  "Bu ayrıştırıcıyı doğruluk açısından incele. Olası hataları belirt."
```

```sh
llm-bridge ask --dry-run --provider claude "Bu tasarımın artılarını ve eksilerini açıkla."
llm-bridge review --dry-run --provider codex --out review.txt "Değişiklikleri incele."
llm-bridge task --dry-run --provider codex --allow-write "Ayrıştırıcının hata mesajlarını iyileştir."
llm-bridge ask --dry-run --provider codex --fallback codex,ollama --timeout-ms 60000 "Algoritmayı açıkla."
llm-bridge ask --dry-run --provider ollama --model your-local-model "Algoritmayı açıkla."
llm-bridge ask --dry-run --pii --prompt -
llm-bridge providers
llm-bridge doctor --json
```

`--prompt -`, UTF-8 metni standart girdiden dosya sonuna kadar okur. Prompt'un kabuk geçmişine girmemesi için bu yolu kullanın. `--file` birden fazla kez verilebilir. `--cwd` çalışma dizinini seçer; eklerin ve `--out` dosyasının göreli yolları bu dizine göre çözülür. Her prompt ve metin eki en fazla 4 MiB olabilir. İkili dosyalar ve bozuk UTF-8 reddedilir. Sağlayıcı yanıtı ve alt süreç çıktısı 8 MiB ile sınırlıdır.

| Mod | Davranış |
| --- | --- |
| `ask` | Salt okunur istek. Codex `read-only` sandbox kullanır. Claude'un yerleşik araçları kapalıdır; gereken bağlamı açıkça ekleyin. |
| `review` | Salt okunur istekle birlikte `git diff HEAD -- .` gönderir. Çalışma dizini altındaki takip edilen dosyaların staged ve unstaged değişikliklerini kapsar. En az bir başlangıç commit'i gerekir. Takip edilmeyen dosyaları `--file` ile ekleyin. Harici diff ve metin dönüştürme yardımcıları çalıştırılmaz. |
| `task` | Açıkça `--allow-write` gerektirir. Codex `workspace-write` kullanır. Claude `acceptEdits` ile Read, Edit, Write, Glob, Grep araçlarını kullanır. HTTP sağlayıcıları yalnızca metin döndürür; araç çalıştırmaz ve dosya değiştirmez. |

`codex` ve `claude`, sırasıyla `codex-cli` ve `claude-code` kısaltmalarıdır. Ayar dosyasında tam adları kullanın. Kendiliğinden başka sağlayıcıya geçilmez. `--fallback` yalnızca `quota_exhausted` veya `timeout` sonrasında devreye girer; tekrarlanan adlar bir kez denenir. Varsayılan olarak her deneme tam süre sınırını alır. `--total-timeout-ms` tüm zincire ortak süre sınırı koyar; sonraki deneme yalnızca kalan süreyi kullanır. Süre dolunca süreç temizliği için sınırlı bir ek bekleme olabilir. Task fallback başlamadan önce kısmi değişiklikler kalabileceğini belirten uyarı yazılır. Yazma görevleri hata vermeden önce bazı dosyaları değiştirmiş olabilir; tekrar denemeden önce çalışma ağacını kontrol edin.

`--dry-run` ayarları yükler, ekleri/review diff'ini okur, aynı gate kontrolünü uygular ve yalnızca sağlayıcı durumunu denetler. JSON planında sağlayıcı, mod, deneme süresi, toplam süre ve eklerin sıra etiketleri/boyutları bulunur. Üretim yapmaz ve `--out` dosyasına yazmaz. Ayarlardaki durum komutları yalnızca sürüm/giriş kontrolü yapmalıdır. Sağlayıcı CLI'da veya ayarlarda seçilmediyse stderr'e `using default provider codex-cli` yazılır.

## Ayarlar

Önce `~/.llm-bridge.json`, ardından `<cwd>/.llm-bridge.json` okunur. Proje değerleri önceliklidir. Gizlilik alanları ve aynı sağlayıcının alanları birleştirilir; diziler ve `modeArgs` gibi iç haritalar bütünüyle değiştirilir. Bilinmeyen alanlar veya bozuk JSON işlemi durdurur. Proje ayarlarını çalıştırılabilir kod gibi değerlendirin; güvenmediğiniz bir depoda önce okuyun.

```json
{
  "provider": "codex-cli",
  "timeoutMs": 120000,
  "gate": {
    "pii": true,
    "allowlist": []
  },
  "providers": {
    "ollama": {
      "baseUrl": "http://127.0.0.1:11434",
      "model": "your-local-model"
    },
    "openai-compatible": {
      "baseUrl": "https://openrouter.ai/api/v1",
      "apiKeyEnv": "OPENROUTER_API_KEY",
      "model": "your-model-id"
    }
  }
}
```

`apiKeyEnv` anahtarın kendisini değil, ortam değişkeninin adını alır. Değeri işletim sistemi veya kendi sır yöneticiniz üzerinden tanımlayın; dosyaya, prompt'a ya da komut argümanlarına yazmayın. `--api-key` ve doğrudan `apiKey` ayarı reddedilir. OpenAI uyumlu sağlayıcıda varsayılan ortam değişkeni adı `OPENAI_API_KEY` olur; `baseUrl` ve model ayrıca gereklidir. Kimlik doğrulaması olmayan yerel bir servis için kütüphane fabrikasında `apiKeyEnv: undefined` kullanılabilir; JSON ayarları bu sağlayıcı için bir ortam değişkeni adı bekler.

OpenAI uyumlu adaptör `baseUrl` sonuna `/chat/completions` ekler. NVIDIA için `https://integrate.api.nvidia.com/v1`, OpenRouter için `https://openrouter.ai/api/v1` kullanılır. Model erişimi ve ücretlendirme servise bağlıdır. Bu sürüm akışsız metin yanıtını destekler; HTTP üzerinden araç çağrısı yürütmez.

HTTP yalnızca loopback adreslerinde kabul edilir; uzak servisler HTTPS kullanmalıdır. URL içinde kullanıcı bilgisi, sorgu veya fragment bulunamaz; yönlendirmeler izlenmez. Ollama adaptörü yalnızca loopback üzerinde çalışır ve `/api/generate` isteğinde `stream: false` gönderir.

| Seçenek | Varsayılan | İşlev |
| --- | --- | --- |
| `--provider` | ayarlar veya `codex-cli` | Sağlayıcı seçer; kısaltmalar desteklenir |
| `--timeout-ms` | 120000 veya ayarlar | Her denemenin süresi; tam sayı milisaniye |
| `--total-timeout-ms` | yok | Tüm zincirin ortak süre sınırı |
| `--dry-run` | kapalı | Üretim yapmadan ayar, gate ve durum kontrolü |
| `--log-dir` | işletim sisteminin geçici dizini | Kayıtların üst dizini |
| `--file` / `--out` | yok | UTF-8 metin ekler / başarılı yanıtı kaydeder |

## Sağlayıcılar ve komut şablonları

Varsayılanlar resmî belgelere dayanır; yine de **kendi sürümünüz için doğrulayın**. Komutlar dizi olarak ayarlanır ve kabuk açılmadan çalıştırılır. Prompt, alt sürecin argümanları yerine standart girdisine yazılır. Argüman sırası `args`, `modeArgs[mod]`, model seçildiyse `modelArgs` şeklindedir. `{model}` yalnızca `modelArgs` içinde değiştirilir.

| Sağlayıcı | Varsayılan davranış | Doctor |
| --- | --- | --- |
| `codex-cli` | `exec --ephemeral --color never`; moduna göre `--sandbox read-only -` veya `--sandbox workspace-write -` | `--version`, ardından `login status` |
| `claude-code` | `-p --output-format text --no-session-persistence`; ask/review için `--tools ""`; task için `--permission-mode acceptEdits --tools Read,Edit,Write,Glob,Grep` | `--version`, ardından `auth status` |
| `ollama` | Yerel HTTP ile metin üretimi | `GET /api/tags` |
| `openai-compatible` | HTTP ile sohbet tamamlaması | Ayarlı kimlikle `GET /models` |

Claude'a tüm modlarda ayrıca `--disallowedTools mcp__*` verilir. `--tools` yalnızca yerleşik araçları sınırlar; bu ek ayar MCP araçlarını da engeller. Hook'lar ve diğer sağlayıcı ayarları geçerliliğini korur.

Doctor ham çıktıyı göstermez; yalnızca erişilebilirlik, giriş durumu ve hata türünü döndürür. Model çağırmaz, giriş yapmaya çalışmaz. Durum komutu desteklenmiyorsa veya servis erişilemiyorsa durum bilinmiyor/erişilemiyor olarak görünür. Bu kontrol bir sonraki üretim isteğinin çalışacağını garanti etmez.

Gemini, Antigravity tarzı veya başka bir CLI için belgelenmiş stdin çağrısını kullanın. Bu araçlara ait tahmin edilmiş bayraklar sunulmaz. Aşağıdaki argümanların tamamı **yer tutucudur**; kendi sürümünüzün belgelerinden doğruladığınız değerlerle değiştirin:

```json
{
  "providers": {
    "my-agent": {
      "command": "your-agent-executable",
      "args": ["VERIFIED_HEADLESS_ARGUMENT"],
      "modeArgs": {
        "ask": ["VERIFIED_READ_ONLY_ARGUMENT"],
        "review": ["VERIFIED_READ_ONLY_ARGUMENT"],
        "task": ["VERIFIED_WORKSPACE_WRITE_ARGUMENT"]
      },
      "modelArgs": ["VERIFIED_MODEL_ARGUMENT", "{model}"],
      "detectArgs": ["VERIFIED_VERSION_ARGUMENT"],
      "authArgs": ["VERIFIED_AUTH_STATUS_ARGUMENT"],
      "errorPatterns": {
        "quota_exhausted": ["capacity depleted"],
        "auth_required": ["session expired"]
      }
    }
  }
}
```

Tüm modları, model argümanlarını ve kota/giriş hata desenlerini kapsayan [çalışır stdin sağlayıcı örneği](docs/custom-providers.md), belgede yer alan JSON doğrudan yüklenerek test edilir. Örnekteki bayraklar gerçek bir CLI'a ait değildir.

Özel hata regex'leri büyük/küçük harfe duyarsızdır ve ilgili hata türünün varsayılan listesini değiştirir. CLI regex'leri sıfır dışı çıkışın tanı metnine, HTTP regex'leri hata yanıtına uygulanır. HTTP 401/403 giriş, 429 kota hatasıdır. Diğer hatalar `nonzero_exit` olur.

Windows'ta yerel çalıştırılabilir dosyalar ve `node_modules` altındaki JavaScript girişine işaret eden standart npm `.cmd` dosyaları kabuk açılmadan desteklenir. Genel batch ve PowerShell sarmalayıcıları çalıştırılmaz. Gerekirse `command` değerini `node`, `args` dizisinin ilk elemanını CLI'ın JavaScript giriş dosyasının tam yolu yapın. Özel şablonların okuma/yazma izinlerini korumak sizin sorumluluğunuzdadır; izinleri atlayan bayraklar eklemeyin.

## Çıktı ve hatalar

Normal çıktıda yanıtın ardından şu üç satır gelir:

```text
LLM_BRIDGE_OUTPUT=""
LLM_BRIDGE_PROVIDER=codex-cli
LLM_BRIDGE_ERROR=
```

`LLM_BRIDGE_OUTPUT`, `--out` verildiyse tam dosya yolunu, aksi durumda boş metni içeren bir JSON string'idir. `--out` dosyasında yalnızca yanıt bulunur; stdout yalnızca bu üç satırı içerir. Eksik üst dizinler oluşturulur; yazma hatasında yol gösterilmeden `Cannot write --out (path relative to --cwd); check directory permissions` bildirilir. Hatalı sonuç mevcut çıktı dosyasının üzerine yazmaz. Son üç satırı ayrıştırın; model metnindeki benzer satırlara güvenmeyin. Otomasyonda `--json` tercih edin: `text`, `provider`, `exitCode`, `errorKind`, `attempts`, `logPath`, `outputPath` alanlarıyla tek bir JSON nesnesi verir.

| Hata türü | Anlamı |
| --- | --- |
| `quota_exhausted` | Kota, istek hızı veya kredi sınırı |
| `auth_required` | Giriş veya API kimlik doğrulaması gerekli |
| `timeout` | Deneme ya da toplam süre sınırı aşıldı |
| `not_installed` | Çalıştırılabilir dosya bulunamadı |
| `empty_output` | Sağlayıcı kullanılabilir metin döndürmedi |
| `nonzero_exit` | Diğer alt süreç, bağlantı veya yanıt hatası |

CLI başarıda `0`, sağlayıcı/girdi/ayar hatasında `1`, gizlilik engelinde `3` ile çıkar. JSON içindeki `exitCode` sağlayıcının çıkışını korur; zaman aşımında 124 kullanılır. Köprünün kendi hataları `privacy_gate` ve `invalid_request` olarak bildirilir; bunlar sağlayıcı hata türlerinden ayrıdır. Gate raporları eşleşen değeri içermez; tür, kaynak etiketi, satır ve sütun verilir. Güvenli girdi hataları bilinmeyen sağlayıcıyı, eksik `--allow-write` iznini, okunamayan eki veya boş prompt'u belirtir. Mesajlarda prompt metni veya dosya içeriği bulunmaz; diğer parser/ayar hataları ayrıntısız kalır. JSON kullanılmıyorsa köprü hatası ayrıca stderr'e yazılır; sağlayıcının ham stderr çıktısı gösterilmez.

## Node kütüphanesi ve eklentiler

```js
import { delegate, GateError } from "llm-bridge";

try {
  const result = await delegate({
    provider: "codex-cli",
    prompt: "Herkese açık gate uygulamasını doğruluk açısından incele.",
    cwd: process.cwd(),
    files: ["src/gate.mjs"],
    mode: "ask",
    dryRun: true,
    timeoutMs: 60000,
    fallback: ["ollama"]
  });
  if (result.errorKind) throw new Error(result.errorKind);
  console.log(result.plan ?? result.text);
} catch (error) {
  if (error instanceof GateError) console.error(error.findings);
  else throw error;
}
```

`config` verilmezse ayar dosyaları yüklenir. Yazma görevinde `allowWrite: true` gerekir. `totalTimeoutMs` zincirin ortak süre sınırını belirler; `dryRun: true` üretim yerine `plan` döndürür. `onWarning(message)` task fallback uyarılarını alır. `logRoot` kayıtların üst dizinini seçer; gerekirse oluşturulur. `doctor()` ve `createProviders(config)` de dışa aktarılır.

Her `providers/*.mjs` modülü varsayılan sağlayıcıyı ve `createProvider(config, gate)` fabrikasını sunar:

```js
{
  name,
  async detect(cwd) { /* { installed, auth, errorKind } */ },
  async run({ prompt, cwd, model, mode, timeoutMs, files, allowWrite }) {
    /* { text, usage?, exitCode, errorKind } */
  }
}
```

Sağlayıcı sınırında `files`, dosya yolları yerine `{ name, text }` anlık kopyaları içerir. Yerleşik adaptörler doğrudan çağrılsa da gizlilik ve yazma kontrollerini yapar. Kütüphaneye `delegate({ providers: ... })` ile ad-sağlayıcı haritası verilebilir; merkezî kontrol bunlar için de çalışır. Eklentiler güvenilen koddur; süre sınırını, mod izinlerini ve normalize sonuçları kendileri uygulamalıdır. CLI ayarları çalıştırılabilir komut şablonlarını destekler, dinamik JavaScript modülü yüklemez.

## Güvenlik sınırları

Prompt, metin ekleri, ek adları ve diff; yaygın API anahtarları, özel anahtar başlıkları, JWT, kimlik bilgisi atamaları ve yüksek entropili dizeler için her zaman taranır. PII kontrolü isteğe bağlıdır: `gate.pii: true` veya `--pii` e-posta, telefon benzeri numara, Luhn doğrulamalı kart ve mod-97 doğrulamalı IBAN taramasını açar. 40/64 karakterlik onaltılık özetler ve resim data URL'leri entropi sezgisinden hariçtir; açık sır biçimleri yine taranır. Uzun yalın tanımlayıcılar ve noktalı sürüm numaraları telefon sayılmaz. Ad, adres, kodlanmış içerik ve her sır biçimi güvenilir biçimde yakalanamaz; hassas metni ayrıca gözden geçirin.

Tek istisna, ayarlardaki `gate.allowlist` dizisinde yer alan **tam eşleşmelerdir**. Bunu yalnızca doğrulanmış, herkese açık test verileri için kullanın; gerçek anahtarı veya özel veriyi buraya yazmayın. Her tarayıcının eşleşmesi ayrı değerlendirilir. Komut satırından kontrolü atlama seçeneği yoktur. Raporlarda eşleşen değer değil, tür ve satır/sütun konumu bulunur.

Kayıtlarda prompt önizlemesinin tamamı `[redacted]` olur; yanıt, yol, model, argüman ve tanı metni tutulmaz. Her çağrı yeni bir geçici `llm-bridge-*` dizininde `run.jsonl` oluşturur. Dosyalar desteklenen sistemlerde 0600 izniyle açılır; Windows'ta klasör ACL'leri geçerlidir. Kayıtlar kendiliğinden silinmez; aşağıdaki kayıt komutlarını kullanın.

Kontrol, ajan CLI'larının kendiliğinden yüklediği depo bağlamını, ayarları, hook'ları, eklentileri, MCP sunucularını ve sonradan okudukları dosyaları kapsamaz. Salt okunur CLI da veriyi dışarı gönderebilir. Hassas işte temiz ve izole bir dizin, doğrulanmış yerel model ve PII kontrolü kullanın. Bu araç genel bir işletim sistemi sandbox'ı değildir. Yerel Ollama servisi de bulut modeli kullanabilir; model ayarınızı kontrol edin. Alt CLI'lar kendi kayıtlarını tutabilir. Model yanıtı güvenilmeyen ve hassas veri içerebilen bir çıktıdır.

Zaman aşımında HTTP isteği iptal edilir; CLI için POSIX süreç grubuna sonlandırma gönderilir, Windows'ta `taskkill /T /F` kullanılır. Temizlik beklemesi sınırlıdır. Bilerek ayrılan süreçler, işletim sistemi izinleri veya uzaktaki servisin zaten kabul ettiği işler bu kontrolü aşabilir. Testler gerçek hesaplara bağlanmaz ve ücretli üretim çağrısı yapmaz.

## Kayıtlar ve saklama

Kayıtlar varsayılan olarak işletim sisteminin geçici dizininde tutulur ve **otomatik silinmez**. `--log-dir` farklı bir üst dizin seçer; gerekirse oluşturulur. Çalıştırma ve kayıt komutlarında aynı dizini kullanın. Prompt, dosya içeriği, yanıt, model, argüman veya ham tanı metni tutulmaz. `logs --last`, son kayıt yolunu ve yalnızca sayı/mantıksal değerlerden oluşan özeti gösterir; ham satırları yazdırmaz.

```sh
llm-bridge logs --last --log-dir is/demo-logs
llm-bridge logs --clean --older-than 7d --log-dir is/demo-logs
```

Temizlik yalnızca tek bir normal `run.jsonl` dosyası içeren `llm-bridge-*` dizinlerini kaldırır. Dosyanın son değişiklik zamanı verilen pozitif gün sayısından eski olmalıdır. Sembolik bağlantılara ve içinde başka dosya olan dizinlere dokunulmaz. Kayıt yolları yerel tanı bilgisidir; paylaşmadan önce gözden geçirin.

## Geliştirme

```sh
npm ci
git config core.hooksPath .githooks
npm run check
```

Pre-commit hook, staged metinleri sırlar için tarar. Testler birleştirilerek üretilen sahte sırlar, geçici Node çalıştırılabilirleri ve yerel HTTP sunucuları kullanır. Geçici test dosyaları yok sayılan `is/tmp/` altında kalır. CI; Ubuntu ve Windows'ta Node 20, 22 ve 24 için lint, JSDoc tür kontrolü ve testleri çalıştırır. Test ortamında alt süreç başlatma ve yerel port dinleme izni gerekir.

[Katkı rehberi](CONTRIBUTING.md), [güvenlik politikası](SECURITY.md) ve [değişiklikler](CHANGELOG.md).

## Sağlayıcı kaynakları

Varsayılanları kurulu sürümünüzle karşılaştırın: [Codex etkileşimsiz kullanım](https://learn.chatgpt.com/docs/non-interactive-mode), [Codex komut referansı](https://learn.chatgpt.com/docs/developer-commands), [Claude Code CLI](https://code.claude.com/docs/en/cli-reference), [Ollama üretim API'ı](https://docs.ollama.com/api/generate), [OpenRouter API](https://openrouter.ai/docs/api_reference/overview) ve [NVIDIA LLM API](https://docs.api.nvidia.com/nim/reference/llm-apis).

## Katkıda bulunma

Kontroller, Conventional Commits ve etiketle çalışan trusted publishing süreci için [CONTRIBUTING.md](CONTRIBUTING.md) dosyasına bakın. Güvenlik açıklarını [SECURITY.md](SECURITY.md) üzerinden özel olarak bildirin. Toplulukta [Contributor Covenant 2.1](CODE_OF_CONDUCT.md) geçerlidir.

## Lisans

[MIT](LICENSE), telif hakkı 2026 Yusuf Berat Zengin.
