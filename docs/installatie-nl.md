# NAS Beheer installeren en gebruiken

NAS Beheer is één webpagina waarmee je de apps op de NAS in de gaten houdt: **Facturen** en **Kasper (chat)**.
Je ziet of alles werkt en wat er moet gebeuren. Je kunt instellingen aanpassen, een app aan- of uitzetten en het logboek lezen.

De pagina werkt **alleen op kantoor** (op het netwerk van kantoor). Thuis of onderweg werkt hij niet, en dat is expres zo.

Deze handleiding heeft drie delen:

- **Deel 1 · Installeren.** Eenmalig, ongeveer een half uur. Je hebt een pc op kantoor nodig en een account op de NAS met beheerrechten.
- **Deel 2 · Het paneel gebruiken.** Voor iedereen.
- **Deel 3 · Wat te doen als…** Oplossingen voor problemen.

---

## Voordat je begint: twee dingen die je vaker nodig hebt

### A · Een `.env`-bestand aanpassen

Elke app op de NAS heeft een bestand met de naam **`.env`** (met een punt ervoor). Daarin staan de instellingen en wachtwoorden van die app.
Je past het zo aan:

1. Log in op de NAS (in de browser: `http://<ip-van-de-nas>:5000`) en open **File Station**.
2. Ga naar de map van de app, bijvoorbeeld **docker** → **factuur-app**.
3. Zie je het bestand `.env` niet? Klik rechtsboven op het **tandwiel** (Instellingen) en zet het vinkje aan bij de optie om **verborgen bestanden te tonen**. Klik op **OK**.
4. Klik met de rechtermuisknop op **`.env`** → **Downloaden**. Het bestand komt in de map **Downloads** op je pc.
5. Open de map **Downloads**. Klik met de rechtermuisknop op `.env` → **Openen met** → **Kladblok**.
6. Pas aan wat er in de stap staat. Let op:
   - Elke instelling staat op een eigen regel, zo: `NAAM=waarde`.
   - Zet **geen spaties** rond het `=`-teken.
   - Regels die met `#` beginnen zijn uitleg; daar doet de app niets mee.
7. Sla op met **Ctrl+S** en sluit Kladblok.
8. Terug in File Station: sleep het bestand `.env` uit je map Downloads in het venster van File Station, in **dezelfde map**. Kies **Overschrijven**.
9. **Verwijder het bestand `.env` daarna uit je map Downloads.** Er staan wachtwoorden in.

> Een `.env`-bestand stuur je nooit per e-mail of chat, en je zet het nooit in een gedeelde map.

### B · Een app opnieuw bouwen (zodat hij de nieuwe instellingen leest)

Een app leest zijn `.env`-bestand alleen bij het bouwen. Na een wijziging doe je dus:

1. Open **Container Manager** op de NAS.
2. Klik links op **Project**.
3. Klik op het project (bijvoorbeeld `factuur-app`).
4. Klik bovenaan op **Actie** → **Bouwen**. Bevestig als erom gevraagd wordt.
5. Wacht tot het bolletje bij het project weer **groen** is. Dat duurt meestal één tot drie minuten.

---

## Deel 1 · Installeren (eenmalig)

Doe de stappen precies in deze volgorde. Sla er geen over.

### Stap 1 · Een netwerk maken waarmee de apps met elkaar praten

Het paneel en de apps draaien elk in een eigen "container" op de NAS. Via een gedeeld netwerk kunnen ze elkaar vinden.
**Dit moet als eerste.** Anders starten Facturen en Kasper niet meer zodra je ze bijwerkt.

1. Open **Container Manager** op de NAS.
2. Klik links op **Netwerk**.
3. Klik op **Toevoegen**.
4. Typ bij **Netwerknaam**: `nas-apps` (kleine letters, met een streepje).
5. Laat alle andere velden zoals ze zijn en klik op **Toepassen**.
6. Je ziet `nas-apps` nu in de lijst staan.

### Stap 2 · Twee beheersleutels maken

**Wat is een beheersleutel?** Een lange, willekeurige tekst. Het werkt als een sleutel en een slot:

- Het **slot** zit in de app (in de `.env` van Facturen of Kasper, bij `ADMIN_KEY`).
- De **sleutel** zit in het paneel (in de `.env` van het paneel).
- Alleen als beide **precies dezelfde tekst** hebben, mag het paneel de app bedienen.

Je maakt er twee: één voor Facturen en één voor Kasper. Zo maak je ze:

1. Klik op je pc op de **Start**-knop van Windows en typ `PowerShell`. Klik op **Windows PowerShell**. Er opent een blauw of zwart venster.
2. Kopieer de regel hieronder in zijn geheel. Klik met de rechtermuisknop in het PowerShell-venster om hem te plakken en druk op **Enter**:

   ```
   $b = New-Object byte[] 32; [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b); -join ($b | ForEach-Object { $_.ToString('x2') })
   ```

3. Je ziet nu een regel van **64 tekens**, alleen cijfers en de letters a tot en met f. Bijvoorbeeld (gebruik deze **niet**, maak je eigen):
   `3f9a0c…` (64 tekens lang)
4. Open **Kladblok** (Start → typ `Kladblok`). Typ `Facturen:` en plak er de sleutel achter. Selecteer de sleutel in PowerShell door er met de muis overheen te slepen, druk op **Enter** om te kopiëren, en plak met **Ctrl+V** in Kladblok.
5. Druk in PowerShell op het pijltje omhoog (↑) en dan op **Enter**. Je krijgt een **nieuwe, andere** sleutel. Zet die in Kladblok achter `Kasper:`.
6. Je Kladblok ziet er nu zo uit (met je eigen sleutels):

   ```
   Facturen: 3f9a0c...
   Kasper:   b71e44...
   ```

7. Laat Kladblok open; je hebt de sleutels in stap 3 en 4 nodig. **Sla dit bestand niet op.** Wil je de sleutels bewaren, zet ze dan in de wachtwoordkluis van het bedrijf.

### Stap 3 · Het "slot" in Facturen en Kasper zetten

**Eerst Facturen:**

1. Zorg dat de nieuwste versie van Facturen in de map **docker** → **factuur-app** staat. (Heeft de beheerder dat al gedaan, dan kun je dit overslaan.)
2. Open het `.env`-bestand van **docker** → **factuur-app** (zie **A** bovenaan).
3. Kijk of er al een regel `ADMIN_KEY=` in staat (zoek met **Ctrl+F**).
   - Staat hij er: zet de **Facturen-sleutel** direct achter het `=`-teken.
   - Staat hij er niet: zet onderaan een nieuwe regel `ADMIN_KEY=` met de Facturen-sleutel erachter.
4. Het ziet er dan zo uit: `ADMIN_KEY=3f9a0c...` (de hele sleutel van 64 tekens, zonder spaties of aanhalingstekens).
5. Sla op en zet het bestand terug op de NAS (zie **A**, stap 7 tot en met 9).
6. Bouw het project `factuur-app` opnieuw (zie **B**).

**Dan Kasper:** precies hetzelfde, maar in de map **docker** → **casper**, met de **Kasper-sleutel**, en bouw daarna het project `casper` opnieuw.

Worden de projecten niet groen? Kijk in Deel 3 bij "Een app start niet meer na het bijwerken".

### Stap 4 · Het paneel op de NAS zetten

**4a · Het pakket klaarzetten** (de beheerder doet dit op de pc waar de code staat):
in de map `nas-beheer` het commando `node scripts/makeNasPackage.js` uitvoeren. Dat maakt het bestand `build\nas-beheer-nas.zip`.

**4b · Op de NAS zetten:**

1. Open **File Station** en ga naar de map **docker**.
2. Klik op **Maken** → **Map maken**. Naam: `nas-beheer`. Klik op **OK**.
3. Open de nieuwe map `nas-beheer`.
4. Sleep `nas-beheer-nas.zip` van je pc in het File Station-venster.
5. Klik met de rechtermuisknop op de zip → **Uitpakken** → **Hier uitpakken**.
6. Je ziet nu onder andere de bestanden `docker-compose.yml`, `Dockerfile` en `.env.example`. De zip mag je daarna verwijderen.

**4c · De instellingen van het paneel invullen:**

1. Klik met de rechtermuisknop op **`.env.example`** → **Kopiëren naar/Verplaatsen naar** → **Kopiëren naar**. Kies dezelfde map (`docker/nas-beheer`).
   Lukt dat niet, download `.env.example` dan, en sla hem in Kladblok op met **Opslaan als** onder de naam `.env`, met bij "Opslaan als type" **Alle bestanden**.
2. Zorg dat het nieuwe bestand precies **`.env`** heet (rechtermuisknop → **Naam wijzigen**).
3. Open `.env` zoals bij **A** en vul in:
   - `PANEL_PASSWORD=` · een wachtwoord voor het paneel, **minstens 12 tekens**. Dit is het wachtwoord dat collega's gebruiken om in te loggen.
   - `FACTUREN_ADMIN_KEY=` · de **Facturen-sleutel** uit je Kladblok.
   - `KASPER_ADMIN_KEY=` · de **Kasper-sleutel** uit je Kladblok.
   - Laat de andere regels zoals ze zijn.
4. Het ziet er dan ongeveer zo uit:

   ```
   PANEL_PASSWORD=EenGoedWachtwoord2026
   FACTUREN_URL=http://factuur-app:8080
   FACTUREN_ADMIN_KEY=3f9a0c...
   KASPER_URL=http://casper:8090
   KASPER_ADMIN_KEY=b71e44...
   ```

5. Sla op en zet het bestand terug (zie **A**, stap 7 tot en met 9).
6. Je kunt Kladblok met de sleutels nu sluiten **zonder op te slaan**.

**4d · Het paneel starten:**

1. Open **Container Manager** → **Project** → **Maken**.
2. Projectnaam: `nas-beheer`.
3. Pad: klik op **Instellen** en kies de map **docker** → **nas-beheer**.
4. Bron: kies **Bestaande docker-compose.yml gebruiken** (of: "docker-compose.yml gebruiken").
5. Klik op **Volgende**, nog eens **Volgende**, en dan **Klaar**.
6. Wacht tot het project **groen** is (de eerste keer kan dat een paar minuten duren).

### Stap 5 · De firewall van de NAS (alleen als die aan staat)

1. Open **Configuratiescherm** → **Beveiliging** → tabblad **Firewall**.
2. Staat het vinkje bij **Firewall inschakelen** uit? Dan ben je klaar met deze stap.
3. Staat het aan: klik op **Regels bewerken** → **Maken**.
4. Kies **Aangepast** → **Aangepast** en vul bij poort `8081` in (protocol **TCP**). Klik op **OK**.
5. Kies bij **Bron-IP** → **Specifiek IP** → **Subnet**, en vul het netwerk van kantoor in. Weet je dat niet: vraag het de beheerder (vaak iets als `192.168.1.0` met masker `255.255.255.0`).
6. Actie: **Toestaan**. Klik op **OK** en daarna op **OK** en **Toepassen**.

> Zet poort 8081 **nooit** open in de router (de internetkastjes). Het paneel is alleen voor kantoor.

### Stap 6 · Het paneel openen

1. Open op een pc op kantoor de browser (Edge of Chrome).
2. Typ in de adresbalk: `http://<ip-van-de-nas>:8081`. Het ip-adres van de NAS is hetzelfde als waarmee je op de NAS inlogt, maar dan met `:8081` erachter. Bijvoorbeeld `http://192.168.1.20:8081`.
3. Log in met de naam `beheerder` en het wachtwoord uit `PANEL_PASSWORD`.
4. Maak voor iedere collega een eigen account aan (zie Deel 2, "Gebruikers"). Gebruik `beheerder` niet samen met anderen.
5. Je ziet bovenaan de tabbladen **Facturen** en **Kasper (chat)**. Staat er bij een app "niet bereikbaar"? Kijk in Deel 3.
6. Tip: maak een bladwijzer (**Ctrl+D**), dan hoef je het adres niet te onthouden.

### Stap 7 · Opruimen

Het paneel heeft het wachtwoord van `beheerder` nu zelf (versleuteld) opgeslagen. Open de `.env` van **docker** → **nas-beheer** nog één keer (zie **A**) en maak de regel leeg: `PANEL_PASSWORD=`. Bouwen is daarna niet nodig.

### Stap 8 · Updates via GitHub (eenmalig, door de beheerder)

Hierna hoef je nooit meer bestanden naar de NAS te kopiëren. Een nieuwe versie gaat zo:

1. De ontwikkelaar zet de wijziging op GitHub, in de branch `release`.
2. GitHub test alles en maakt de nieuwe versie klaar. Op de NAS verandert nog niets.
3. In het paneel: **Paneel** → **Updates** → **Zoek nieuwe versie**, en daarna **Bijwerken**. Alleen die app start opnieuw; instellingen, gegevens en facturen blijven staan.

Eenmalig instellen:

1. **Een leessleutel voor GitHub maken.** Ga op github.com naar je profielfoto → **Settings** → **Developer settings** → **Personal access tokens** → **Tokens (classic)** → **Generate new token (classic)**. Naam: `NAS lezen`. Vink **alleen** `read:packages` aan. Kies een vervaldatum (bijvoorbeeld een jaar) en klik op **Generate token**. Kopieer de code (begint met `ghp_`) naar je wachtwoordkluis.
2. **Een updatersleutel maken**, net als de beheersleutels in Stap 2 (de regel in PowerShell).
3. **De `.env` van docker → nas-beheer aanvullen** (zie **A**):
   - `UPDATER_KEY=` met de updatersleutel
   - `GHCR_USER=stolemynikes`
   - `GHCR_TOKEN=` met de leessleutel van GitHub
4. **Eén laatste keer bestanden kopiëren:** de nieuwe `docker-compose.yml` van Facturen, Kasper en het paneel (daarin staat nu waar de versies van GitHub vandaan komen, en de updater). Bouw daarna alle drie nog één keer (zie **B**, of met `sudo docker compose -p <project> up -d --build`).
5. In het paneel staat onder **Paneel** → **Updates** nu per app de versie. Staat er "zelf gebouwde versie", dan komt hij na de eerste keer **Bijwerken** van GitHub.

> De updater (container `nas-beheer-updater`) is het enige onderdeel dat Docker op de NAS mag bedienen. Hij doet niets uit zichzelf, heeft geen poort naar buiten, werkt alleen met de updatersleutel en kent alleen Facturen, Kasper en het paneel.

---

## Deel 2 · Het paneel gebruiken

Bovenaan staan tabbladen: één per app, plus **Algemeen**, **Logboek** en **Paneel**. Het bolletje naast de naam zegt hoe het gaat:

- **groen** · alles in orde
- **geel** · let op, maar het werkt
- **rood** · er moet iets gebeuren

Het label achter de naam zegt of de app **TEST** (geel: om uit te proberen, echte klanten merken niets) of **LIVE** (groen: werkt echt voor klanten) draait.
Op elke pagina van een app staat dat ook nog eens in een balk bovenaan.

### Per app: Overzicht, Instellingen, Logboek

Per app zie je eerst het **Overzicht**:

- **Moet ik iets doen?** · Staat hier "Nee", dan hoef je niets te doen. Staat er iets, dan lees je waarom en wat je moet doen. Vaak staat er een knop bij, zoals "Opnieuw proberen".
- **Werkt alles?** · de verbindingen van de app, elk met een vinkje of een waarschuwing.
- **Aan/uit** · Uitzetten vraagt altijd eerst of je het zeker weet.
- **App opnieuw starten** · Helpt als een app vastzit of vreemd doet. Klik op **Opnieuw starten** en daarna op **Ja, opnieuw starten**. Na een paar seconden staat er "draait weer". Er gaat niets verloren.

Bij **Instellingen** (knop bovenaan, naast Overzicht) staat elke instelling als een gewone vraag, bijvoorbeeld "Wie krijgen er een factuur?".

1. Klik bij een vraag op het antwoord dat je wilt. Bij elk antwoord staat wat er dan gebeurt.
2. Onderaan verschijnt een balk met wat je hebt veranderd, bijvoorbeeld "Alleen testorders → Alle betaalde orders".
3. Klik op **Opslaan** en daarna op **Ja, opslaan**. Klopt het toch niet? Klik op **Ongedaan maken**.
4. De app start een paar seconden opnieuw; dat is normaal.

Een antwoord met een **LIVE**-label (zoals "Alle betaalde orders") vraagt een extra bevestiging in rood: vanaf dat moment merken echte klanten het.
Onder **Koppelingen** staat met welke boekhouding en webshop de app verbonden is, met de knop **Exact opnieuw koppelen**.
Onder **Voor de beheerder** (ingeklapt) staan technische instellingen. Die verander je alleen als de beheerder dat vraagt.

Het **Logboek** laat zien wat de apps de afgelopen 30 dagen gedaan hebben, nieuwste bovenaan.
Het tabblad **Logboek** bovenaan toont alle apps samen; de knop **Logboek** bij een app (naast Overzicht en Instellingen) toont alleen die app.
Zoek bijvoorbeeld op een ordernummer (zoals `LD1012`). Met "Alleen problemen" zie je alleen wat er misging.
"Technische details tonen" is voor de beheerder.

Bij **Kasper** staat naast Overzicht de knop **Cijfers**: hoeveel gesprekken er waren (vandaag, deze week, deze kalendermaand), hoeveel orders en producten er zijn opgezocht, hoe vaak het contactformulier is gebruikt, hoeveel **tokens** de AI heeft gebruikt, en wat dat ongeveer **kost** (in dollars, zoals Anthropic het rekent). Daaronder een balkje per dag voor de laatste 30 dagen. Er worden alleen aantallen bijgehouden, nooit wat klanten schrijven.

De kosten zijn een schatting. Een beheerder vult daarvoor één keer de prijzen in (Kasper start daarvoor niet opnieuw): Kasper → **Instellingen** → **Voor de beheerder** → "Prijs voor lezen" en "Prijs voor schrijven" (dollar per miljoen tokens, te vinden op de prijzenpagina van Anthropic bij het gebruikte AI-model). De echte rekening staat in de Anthropic Console.

**Meldingen.** Rechtsonder verschijnen korte meldingen, bijvoorbeeld "Kasper is opnieuw gestart" (een beheerder ziet ook wie het deed en wat er veranderd is), "Facturen antwoordt niet" of "Opgeslagen". Ze verdwijnen vanzelf; met × sluit je ze meteen.

**Altijd actueel.** De pagina ververst zichzelf elke 20 seconden, behalve als je iets aan het invullen bent. Wordt het paneel bijgewerkt, dan neemt de pagina de nieuwe versie vanzelf over en blijf je waar je was.

### Kasper: het chatadres automatisch in de webshop

Zonder vast adres krijgt Kasper na elke herstart een nieuw tijdelijk adres. Dan verdwijnt de chatknop uit de webshop tot iemand de script-tag in het thema aanpast. Kasper kan dat zelf doen. Eenmalig, door de beheerder:

1. **Thema aanpassen.** Shopify → **Online Store** → **Themes** → bij het thema op **…** → **Edit code** → `layout/theme.liquid`. Vervang de oude regel met `widget.js` door:
   ```
   {% if shop.metafields.kasper.widget_url %}<script src="{{ shop.metafields.kasper.widget_url.value }}/widget.js" defer></script>{% endif %}
   ```
   Klik op **Save**.
2. **Aanzetten.** In het paneel: Kasper → **Instellingen** → "Moet Kasper zijn adres zelf in de webshop zetten?" → **Ja, automatisch** → Opslaan.
3. **Controleren.** Kasper → Instellingen → **Koppelingen** → "Chatadres in de webshop" moet na een paar minuten op **automatisch** staan. Staat er **geen toegang**, dan mag de Shopify-app van Kasper dit nog niet schrijven: de beheerder moet die app een extra recht geven (metafields schrijven) en de app opnieuw goedkeuren in de winkel.

Kasper schrijft alleen dit ene veld (`kasper.widget_url`) en alleen een adres dat eindigt op `.trycloudflare.com` of op ons eigen domein.

### Gebruikers, rollen en je eigen wachtwoord

Iedereen logt in met een eigen naam en wachtwoord. Er zijn drie rollen:

- **Alleen kijken** · mag alles zien, maar niets veranderen.
- **Medewerker** · mag de apps bedienen: instellingen, opnieuw proberen, opnieuw starten, aan/uit, Exact koppelen. Niet: Algemeen, technische instellingen, gebruikers.
- **Beheerder** · mag alles, ook Algemeen, technische instellingen, gebruikers en de actielog.

**Je eigen wachtwoord wijzigen** (iedereen): tabblad **Paneel** → **Mijn wachtwoord**. Vul je huidige wachtwoord in en twee keer het nieuwe (minstens 12 tekens). Na het wijzigen werkt het oude wachtwoord nergens meer.

**Een collega toevoegen** (beheerder):
1. Tabblad **Paneel** → **Gebruikers** → **Gebruiker toevoegen**.
2. Vul een naam in (kleine letters, bijvoorbeeld `jan`), kies een rol en een tijdelijk wachtwoord.
3. Geef naam en tijdelijk wachtwoord persoonlijk door, niet per mail.
4. Bij het eerste inloggen moet de collega meteen een eigen wachtwoord kiezen.

Bij elke gebruiker kan een beheerder de **Rol** veranderen, een **Nieuw wachtwoord** geven (als iemand het vergeten is) of de gebruiker **Verwijderen**. Er blijft altijd minstens één beheerder.

**Actielog** (beheerder): onder **Paneel** zie je wie wat heeft gedaan en wanneer, een jaar lang. Bijvoorbeeld "jan · Instellingen Facturen · Mailen: Ja → Nee". Wachtwoorden en sleutels staan er nooit in.

### Tabblad Algemeen: wat voor alle apps geldt

- **Test of live** · per onderdeel (Facturen, Kasper, de webshop, Exact) of het TEST of LIVE is, met een knop **Naar instellingen**. Omzetten doe je altijd bij de app zelf, zodat er nooit per ongeluk alles tegelijk live gaat.
- **Webshop (Shopify)** · met welke webshop de apps verbonden zijn. Met **Andere webshop koppelen** stap je over naar een andere webshop (bijvoorbeeld van de testwinkel naar de echte):
  1. Vul het adres in dat eindigt op `.myshopify.com` (in Shopify: **Instellingen** → **Domeinen**).
  2. Klik op **Verbinding testen**. Het paneel kijkt bij elke app of die de webshop kan lezen. Er verandert nog niets.
  3. Staat bij elke app een vinkje? Lees de rode waarschuwing en klik op **Ja, koppel deze webshop**. Doe dit alleen samen met de beheerder.
- **Vaste internetadressen** · zie hieronder.
- **Contactadres van de winkel** · het adres (info@) dat Facturen in de factuurmail noemt en waar Kasper vragen heen stuurt. Pas het aan en klik op **Opslaan voor alle apps**.

### Vaste internetadressen (zoals chat.laboratoriumdiscounter.nl)

De webshop bereikt de apps op de NAS via een internetadres: de factuurknop in het klantaccount en de chat.
Zonder vast adres krijgt een app een **tijdelijk** adres, dat bij elke herstart van de NAS verandert. Met een **vast** adres gebeurt dat nooit meer.

**Eenmalig, door de beheerder: ngrok koppelen.** ngrok is de dienst die de vaste adressen levert. Je hebt een betaald abonnement nodig, want gratis kun je geen eigen domein gebruiken.

1. Maak een account op `ngrok.com` en kies een abonnement met eigen domeinen.
2. Kopieer in het ngrok-dashboard bij **Your Authtoken** de lange code. Maak bij **API Keys** een nieuwe sleutel en kopieer die ook. Zet ze in je wachtwoordkluis.
3. Open de `.env` van **docker** → **nas-beheer** (zie **A**) en vul in:
   - `COMPOSE_PROFILES=ngrok`
   - `NGROK_AUTHTOKEN=` met de authtoken
   - `NGROK_API_KEY=` met de API-sleutel
4. Sla op, zet het bestand terug en bouw het project `nas-beheer` opnieuw (zie **B**). Er komt een tweede container bij: `nas-beheer-ngrok`.
5. In het paneel, tabblad **Algemeen**, staat nu "ngrok-account gekoppeld".

**Een vast adres maken (kan iedereen, met toegang tot Hostnet):**

1. Klik bij de app op **Vast adres instellen**.
2. **Adres kiezen** · typ hoe het adres begint, bijvoorbeeld `chat`, en klik op **Adres aanmaken**.
3. **Bij Hostnet invullen** · het paneel toont drie dingen (Type, Naam, Waarde) met kopieerknoppen. Log in op `mijn.hostnet.nl`, ga naar het DNS-beheer van `laboratoriumdiscounter.nl`, voeg een record toe en neem die drie dingen over. De namen in het scherm van Hostnet kunnen iets anders zijn dan in deze handleiding.
4. **Controleren** · klik op **Ik heb het ingevuld** en dan op **Controleren**. Staat er "Nog niet gevonden"? Dat is normaal vlak na het invullen: het kan tot een paar uur duren. Klik later opnieuw. Halverwege kun je het venster sluiten; met **Verder** ga je later verder waar je was.
5. **Klaar** · staan er twee vinkjes, klik dan op **Gebruiken voor …**. De app staat nu op **VAST**.
6. Nog één keer door de beheerder: voor Facturen het nieuwe adres in de factuurknop zetten (Shopify-extensies bijwerken), voor Kasper het chat-script in het thema. Daarna hoeft dat nooit meer.

---

## Deel 3 · Wat te doen als…

**…ik mijn wachtwoord niet meer weet?**
Vraag een beheerder. Die geeft je een tijdelijk wachtwoord: **Paneel** → **Gebruikers** → bij jouw naam **Nieuw wachtwoord**. Daarna kies je bij het inloggen een eigen wachtwoord.

**…er staat "Dit mag jouw account niet"?**
Jouw rol mag dat niet. Vraag een beheerder om het te doen, of om je rol te veranderen.

**…geen enkele beheerder het wachtwoord meer weet?**
Dit zet het wachtwoord van de gebruiker `beheerder` terug.
1. Open de `.env` van **docker** → **nas-beheer** (zie **A**).
2. Zet achter `PANEL_PASSWORD=` een nieuw wachtwoord (minstens 12 tekens).
3. Zet achter `PANEL_PASSWORD_RESET=` het woord `true`. Staat die regel er niet, zet dan onderaan `PANEL_PASSWORD_RESET=true`.
4. Sla op, zet het bestand terug, en bouw het project `nas-beheer` opnieuw (zie **B**).
5. Log in met de naam `beheerder` en het nieuwe wachtwoord.
6. Open `.env` nog een keer en maak beide regels weer leeg: `PANEL_PASSWORD=` en `PANEL_PASSWORD_RESET=`. Sla op en zet terug. Bouwen is niet nodig.

**…er staat "Te vaak een verkeerd wachtwoord"?**
Wacht 10 minuten en probeer het opnieuw. Let op Caps Lock.

**…de pagina niet opent?**
1. Zit je op kantoor? Thuis werkt het niet.
2. Klopt het adres, met `:8081` erachter en `http://` (niet `https://`)?
3. Kijk in **Container Manager** → **Project** of `nas-beheer` groen is. Zo niet: klik erop → **Actie** → **Starten**.
4. Werkt het nog niet: kijk bij Stap 5 (firewall).

**…bij een app "Antwoordt niet" staat?**
1. Open **Container Manager** → **Project** en kijk of die app groen is. Zo niet: klik erop → **Actie** → **Starten**.
2. Is hij wel groen? Klik links op **Container** → dubbelklik op de container van de app (`factuur-app` of `casper`) → tabblad **Netwerk**. Daar moet `nas-apps` tussen staan. Staat het er niet, doe dan Stap 1 en bouw de app opnieuw (zie **B**).

**…bij een app "Geen toegang" of "Klopt de beheersleutel?" staat?**
De sleutel in het paneel is niet precies gelijk aan die in de app.
1. Open de `.env` van de app (bijvoorbeeld **docker** → **factuur-app**) en kopieer de tekst achter `ADMIN_KEY=`.
2. Open de `.env` van **docker** → **nas-beheer** en plak die tekst achter `FACTUREN_ADMIN_KEY=` (of `KASPER_ADMIN_KEY=` voor Kasper). Let op: geen spatie ervoor of erachter.
3. Sla op, zet terug en bouw het project `nas-beheer` opnieuw (zie **B**).

**…een app niet meer start na het bijwerken?**
Meestal ontbreekt het netwerk `nas-apps`. Doe Stap 1 en bouw de app daarna opnieuw (zie **B**).

**…"Order … heeft (nog) geen factuur"?**
Lees de reden en doe wat erbij staat. Meestal moet er iets in Exact of Shopify worden aangepast. Klik daarna op **Opnieuw proberen**. De app probeert het ook zelf steeds opnieuw.

**…"Boekhouding (Exact) — niet gekoppeld"?**
1. Klik op **Koppel Exact opnieuw** en daarna op **Inloggen bij Exact**. Er opent een nieuw tabblad.
2. Log in bij Exact en klik op **Toestaan**.
3. Je komt op een pagina die niet laadt of een foutmelding geeft. Dat is normaal.
4. Klik in de adresbalk van dat tabblad, selecteer het hele adres (**Ctrl+A**) en kopieer het (**Ctrl+C**).
5. Ga terug naar het paneel, plak het adres in het vak (**Ctrl+V**) en klik op **Koppelen**.

Doe dit **alleen via het paneel**, nooit vanaf een eigen pc met een ander programma. Anders werkt de koppeling op de NAS niet meer.

**…"Factuurknop in de webshop — werkt, maar tijdelijk"?**
Dat klopt zolang er nog geen vast internetadres is. Na een herstart van de NAS moet de beheerder het nieuwe adres in de Shopify-app zetten. Met een vast adres (Algemeen → Vaste internetadressen) is dat voorbij.

**…een app vastzit of vreemd doet?**
Ga naar die app → **Overzicht** → **App opnieuw starten**. Werkt die knop niet omdat de app helemaal niet antwoordt? Herstart hem dan in **Container Manager** → **Project** → de app → **Actie** → **Opnieuw opstarten**.

**…"De ngrok-container antwoordt niet"?**
Kijk in **Container Manager** of `nas-beheer-ngrok` draait. Staat hij er niet? Controleer dan `COMPOSE_PROFILES=ngrok` in de `.env` van het paneel en bouw `nas-beheer` opnieuw (zie **B**).

**…ik een app per ongeluk heb uitgezet?**
Klik bij die app op **Aanzetten**. Facturen maakt daarna alsnog de facturen voor orders die intussen betaald zijn.

**…de pagina leeg blijft of vreemd doet?**
Druk op **F5** om de pagina te verversen. Helpt dat niet, log dan uit en weer in.
