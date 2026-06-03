// ═══════════════════════════════════════════════════════════
//  PATCH: arrivals-purpose.js  — wire up guest-memory.js
//
//  Make EXACTLY these 6 changes. Search for the old string,
//  replace with the new one. Nothing else changes.
// ═══════════════════════════════════════════════════════════


// ──────────────────────────────────────────────────────────
//  PATCH 1 of 6  —  arrRender():  nat field onchange
//  This saves nationality to memory when you type it
// ──────────────────────────────────────────────────────────
// FIND:
        <input value="${g.nat}" onchange="arrGuests[${i}].nat=this.value" style="width:86px;"/>

// REPLACE WITH:
        <input value="${g.nat}" onchange="arrGuests[${i}].nat=this.value;gmOnEdit(arrGuests[${i}].name,'nat',this.value);saveArrivals(arrGuests)" style="width:86px;${g._fromMemory?'border-color:var(--sky);':''}"/>


// ──────────────────────────────────────────────────────────
//  PATCH 2 of 6  —  arrRender():  email field onchange
// ──────────────────────────────────────────────────────────
// FIND:
      <td><input value="${g.email}"   onchange="arrGuests[${i}].email=this.value" style="width:138px;"/></td>

// REPLACE WITH:
      <td><input value="${g.email}"   onchange="arrGuests[${i}].email=this.value;gmOnEdit(arrGuests[${i}].name,'email',this.value);saveArrivals(arrGuests)" style="width:138px;${g._fromMemory?'border-color:var(--sky);':''}"/></td>


// ──────────────────────────────────────────────────────────
//  PATCH 3 of 6  —  loadArrivals():  auto-fill after load
//  Find the line:  arrGuests = guests; arrRender();
//  Add gmAutoFill on the next line
// ──────────────────────────────────────────────────────────
// FIND:
  arrGuests = guests; arrRender(); setTimeout(() => runAINat_arr(), 300);

// REPLACE WITH:
  arrGuests = guests;
  if (typeof gmAutoFill === 'function') gmAutoFill(arrGuests);
  arrRender();
  setTimeout(() => runAINat_arr(), 300);


// ──────────────────────────────────────────────────────────
//  PATCH 4 of 6  —  purposeRender():  nat field onchange
// ──────────────────────────────────────────────────────────
// FIND (in purposeRender, the nat input — same pattern as arrivals):
        <input value="${g.nat}" onchange="purposeGuests[${i}].nat=this.value" style="width:86px;"/>

// REPLACE WITH:
        <input value="${g.nat}" onchange="purposeGuests[${i}].nat=this.value;gmOnEdit(purposeGuests[${i}].name,'nat',this.value);savePurpose(purposeGuests)" style="width:86px;${g._fromMemory?'border-color:var(--sky);':''}"/>


// ──────────────────────────────────────────────────────────
//  PATCH 5 of 6  —  purposeRender():  email field onchange
// ──────────────────────────────────────────────────────────
// FIND (in purposeRender):
      <td><input value="${g.email}"   onchange="purposeGuests[${i}].email=this.value" ...

// REPLACE WITH:
      <td><input value="${g.email}"   onchange="purposeGuests[${i}].email=this.value;gmOnEdit(purposeGuests[${i}].name,'email',this.value);savePurpose(purposeGuests)" ...


// ──────────────────────────────────────────────────────────
//  PATCH 6 of 6  —  loadPurpose():  auto-fill after load
// ──────────────────────────────────────────────────────────
// FIND:
  purposeGuests = guests; purposeRender(); setTimeout(() => runAINat_purpose(), 300);

// REPLACE WITH:
  purposeGuests = guests;
  if (typeof gmAutoFill === 'function') gmAutoFill(purposeGuests);
  purposeRender();
  setTimeout(() => runAINat_purpose(), 300);


// ──────────────────────────────────────────────────────────
//  ALSO: In index.html, add gmInit() to your app startup.
//  Find where you call dbInit() and add the line after it:
// ──────────────────────────────────────────────────────────
// FIND (in your init sequence):
  dbInit();

// ADD AFTER:
  gmInit();   // ← loads guest memory from Firebase


// ──────────────────────────────────────────────────────────
//  ALSO: In index.html, add the script tag before </body>:
// ──────────────────────────────────────────────────────────
/*
  <script src="guest-memory.js"></script>
*/

// ──────────────────────────────────────────────────────────
//  ALSO: In index.html, add the nav item inside your nav list:
// ──────────────────────────────────────────────────────────
/*
  <div class="nav-item" id="nav-guestmem" onclick="showPanel('guestmem')">
    <span class="nav-icon">🧠</span>
    <span class="nav-label">Guest Memory</span>
    <span class="nav-badge" id="badge-guestmem">0</span>
  </div>
*/

// ──────────────────────────────────────────────────────────
//  DONE. That's everything.
// ──────────────────────────────────────────────────────────
