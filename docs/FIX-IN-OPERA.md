# Fix in Opera (v626)

Immigration Check → **Fix in Opera** card. Upload the Opera immigration report and the Vicas Inhouse XML as before.

1. The card lists guests whose **gender, nationality or ID number** is empty in the report and the value Vicas (or the title) suggests. Matching is by **room + name**; two guests in a room that fit the same name are never guessed.
2. Edit a value if needed and tick what is approved. Nationality from Vicas is on by default; gender guesses and **every ID number** need your tap. Press **Copy plan for the Opera fixer**.
3. In Opera Cloud open the console (F12), paste `tools/hotelops-opera-fixer.console.js`, paste the plan, **Load plan**.
4. Pick a room, open that guest's profile in Opera, press **Check & fill**. It checks the name on screen, fills only empty fields (a masked number counts as filled), highlights them and **stops**. You press Save.
5. **Dry run** is on by default: untick it to actually type.
6. After a session press **Copy log** in the fixer and paste it in the card's **Save log for the team**.

Safety: the fixer never clicks Save, OK, Submit, Apply, Confirm, Done, Yes, Delete or Cancel. ID numbers live only in the browser tab (the copied plan contains them: do not share it). The shared record and the log keep gender and nationality codes and **only the last 4 of an ID number**, never names. Nothing real goes into the repo; tests use made-up guests and a mock Opera page.

Not done (v2): opening each room by itself and auto-save.

ID type (matches the real Opera list): UAE documents are `RES` or `IDC`. Opera has no Emirates ID code, so the plan shows a RES/IDC choice on each Emirates ID row (default none) and remembers your pick for the hotel. Other documents get `PAS` (passport). `GCC ID` is for other GCC nationals' cards and is never chosen for you. An ID number is only typed together with its ID type. Opera shows ID numbers masked, so a masked number counts as already filled; nothing is typed over it.

On the Opera page: Manage Profile > Identification. Nationality is a 2-letter code, gender is M or F. Fields are matched by their label text. The fixer clicks Edit but never Save, Cancel, New or the red X on a document tab.
