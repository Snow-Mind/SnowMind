---
description: Phase 5: Frontend + Final QA
---



Before marking any file complete, verify:
SOLIDITY:
□ All functions have NatSpec comments
□ All external calls check return values
□ No unbounded loops
□ Two-step ownership transfer implemented
□ Events emitted for all state changes
□ Tests cover: happy path, auth failures, edge cases, zero values
PYTHON BACKEND:
□ All Decimal math (no float for financial values)
□ All RPC calls wrapped in try/except with retry logic
□ All DB calls wrapped in try/except
□ Scheduler distributed lock acquired before any account processing
□ TWAP reads from DB, writes to DB on every cycle
□ Cold-start guard: skip rebalance if < 3 snapshots exist
□ Every check in the 19-step flow returns a typed result
□ Agent fee is zero when fee_exempt = true
□ DefiLlama timeout/error → log warning, continue (never block)
NODE.JS EXECUTION SERVICE:
□ userEOA always read from kernelAccount.getOwner()
□ Pimlico failure → retry once → Alchemy fallback
□ Both bundlers fail → return error to backend, log alert
□ No hardcoded user amount in withdrawal UserOp (use MaxUint256 sweep)
FRONTEND:
□ Deposit < $10K: skip allocation page, auto-route to highest APY
□ Deposit ≥ $10K: show allocation sliders with live APY projection
□ Show "you're leaving $X/yr" when allocation is suboptimal vs maximum
□ Session key renewal prompts when < 48h remaining
□ Emergency withdrawal available at all times from any page
□ "Agent fee" language used consistently — never "performance fee"
□ Beta users see "Fee: Free (beta)" in fee display
</quality_checklist>
<critical_addresses>
Never hardcode these inline — always import from constants.ts or config.py.
If these addresses change, they should change in exactly one place.
USDC:          0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E
AAVE_POOL:     0x794a61358D6845594F94dc1DB02A252b5b4814aD
BENQI_QIUSDC:  0xB715808a78F6041E46d61Cb123C9B4A27056AE9C
SPARK_SPUSDC:  0x28B3a8fb53B741A8Fd78c0fb9A6B2393d896a43d
ENTRY_POINT:   0x0000000071727De22E5E9d8BAf0edAc6f37da032
CHAIN_ID:      43114
Treasury (Gnosis Safe): to be set in env — SNOWMIND_TREASURY_ADDRESS
Registry: to be set in env after deployment — SNOWMIND_REGISTRY_ADDRESS
</critical_addresses>
Now build all files in the order specified. Start with Phase 1.
For each file, state the filename as a header, then output the complete file content.
Do not truncate any file. Do not use "// ... rest of implementation" shortcuts.
Every function must be fully implemented with real logic.ShareContentARCHITECTURE.mdmdARCHITECTURE.mdmdSnowMindRegistry.solsol(function(){function c(){var b=a.contentDocument||a.contentWindow.document;if(b){var d=b.createElement('script');d.nonce='FcbMk2AmlfOBk3qn3XKeiQ==';d.innerHTML="window.__CF$cv$params={r:'9de66e462acbb630',t:'MTc3Mzg1OTkwNy4wMDAwMDA='};var a=document.createElement('script');a.nonce='FcbMk2AmlfOBk3qn3XKeiQ==';a.src='/cdn-cgi/challenge-platform/scripts/jsd/main.js';document.getElementsByTagName('head')[0].appendChild(a);";b.getElementsByTagName('head')[0].appendChild(d)}}if(document.body){var a=document.createElement('iframe');a.height=1;a.width=1;a.style.position='absolute';a.style.top=0;a.style.left=0;a.style.border='none';a.style.visibility='hidden';document.body.appendChild(a);if('loading'!==document.readyState)c();else if(window.addEventListener)document.addEventListener('DOMContentLoaded',c);else{var e=document.onreadystatechange||function(){};document.onreadystatechange=function(b){e(b);'loading'!==document.readyState&&(document.onreadystatechange=e,c())}}}})();
  @keyframes intercom-lightweight-app-launcher {
    from {
      opacity: 0;
      transform: scale(0.5);
    }
    to {
      opacity: 1;
      transform: scale(1);
    }
  }

  @keyframes intercom-lightweight-app-gradient {
    from {
      opacity: 0;
    }
    to {
      opacity: 1;
    }
  }

  @keyframes intercom-lightweight-app-messenger {
    0% {
      opacity: 0;
      transform: scale(0);
    }
    40% {
      opacity: 1;
    }
    100% {
      transform: scale(1);
    }
  }

  .intercom-lightweight-app {
    position: fixed;
    z-index: 2147483001;
    width: 0;
    height: 0;
    font-family: system-ui, "Segoe UI", Roboto, Helvetica, Arial, sans-serif, "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol";
  }

  .intercom-lightweight-app-gradient {
    position: fixed;
    z-index: 2147483002;
    width: 500px;
    height: 500px;
    bottom: 0;
    right: 0;
    pointer-events: none;
    background: radial-gradient(
      ellipse at bottom right,
      rgba(29, 39, 54, 0.16) 0%,
      rgba(29, 39, 54, 0) 72%);
    animation: intercom-lightweight-app-gradient 200ms ease-out;
  }

  .intercom-lightweight-app-launcher {
    position: fixed;
    z-index: 2147483003;
    padding: 0 !important;
    margin: 0 !important;
    border: none;
    bottom: 20px;
    right: 20px;
    max-width: 48px;
    width: 48px;
    max-height: 48px;
    height: 48px;
    border-radius: 50%;
    background: #0099CC;
    cursor: pointer;
    box-shadow: 0 1px 6px 0 rgba(0, 0, 0, 0.06), 0 2px 32px 0 rgba(0, 0, 0, 0.16);
    transition: transform 167ms cubic-bezier(0.33, 0.00, 0.00, 1.00);
    box-sizing: content-box;
  }


  .intercom-lightweight-app-launcher:hover {
    transition: transform 250ms cubic-bezier(0.33, 0.00, 0.00, 1.00);
    transform: scale(1.1)
  }

  .intercom-lightweight-app-launcher:active {
    transform: scale(0.85);
    transition: transform 134ms cubic-bezier(0.45, 0, 0.2, 1);
  }


  .intercom-lightweight-app-launcher:focus {
    outline: none;

    
  }

  .intercom-lightweight-app-launcher-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    position: absolute;
    top: 0;
    left: 0;
    width: 48px;
    height: 48px;
    transition: transform 100ms linear, opacity 80ms linear;
  }

  .intercom-lightweight-app-launcher-icon-open {
    
        opacity: 1;
        transform: rotate(0deg) scale(1);
      
  }

  .intercom-lightweight-app-launcher-icon-open svg {
    width: 24px;
    height: 24px;
  }

  .intercom-lightweight-app-launcher-icon-open svg path {
    fill: rgb(255, 255, 255);
  }

  .intercom-lightweight-app-launcher-icon-self-serve {
    
        opacity: 1;
        transform: rotate(0deg) scale(1);
      
  }

  .intercom-lightweight-app-launcher-icon-self-serve svg {
    height: 44px;
  }

  .intercom-lightweight-app-launcher-icon-self-serve svg path {
    fill: rgb(255, 255, 255);
  }

  .intercom-lightweight-app-launcher-custom-icon-open {
    max-height: 24px;
    max-width: 24px;

    
        opacity: 1;
        transform: rotate(0deg) scale(1);
      
  }

  .intercom-lightweight-app-launcher-icon-minimize {
    
        opacity: 0;
        transform: rotate(-60deg) scale(0);
      
  }

  .intercom-lightweight-app-launcher-icon-minimize svg path {
    fill: rgb(255, 255, 255);
  }

  /* Extended launcher styles */
  .intercom-lightweight-app-launcher.intercom-launcher-extended {
    width: calc(180px - 30px);
    max-width: calc(180px - 30px);
    height: calc(45px - 26px);
    max-height: calc(45px - 26px);
    border-radius: 12px;
    display: flex;
    align-items: center;
    justify-content: flex-start;
    padding: 12px 16px 12px 12px !important;
    gap: 6px;
    /* Use theme background instead of hardcoded gradient */
    background: #0099CC;
    border: 1px solid rgba(255, 255, 255, 0.15);
    box-shadow: 0px -2px 50px rgba(0, 0, 0, 0.1);
    
  }

  .intercom-lightweight-app-launcher.intercom-launcher-extended .intercom-lightweight-app-launcher-icon {
    position: relative;
    width: 24px;
    height: 24px;
  }

  .intercom-lightweight-app-launcher-text {
    /* Match text color with launcher icon */
    color: rgb(255, 255, 255);
    font-size: 14px;
    font-weight: 600;
    line-height: 1.5;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 140px;
    opacity: 1;
    transition: opacity 80ms linear;
  }

  .intercom-lightweight-app-messenger {
    position: fixed;
    z-index: 2147483003;
    overflow: hidden;
    background-color: #ffffff;
    animation: intercom-lightweight-app-messenger 250ms cubic-bezier(0, 1, 1, 1);
    transform-origin: bottom right;

    
        width: 400px;
        height: calc(100% - 40px);
        max-height: 704px;
        min-height: 250px;
        right: 20px;
        bottom: 20px;
        box-shadow: 0 5px 40px rgba(0,0,0,0.16);
      

    border-radius: 24px;
  }

  .intercom-lightweight-app-messenger-header {
    height: 64px;
    border-bottom: none;
    background: #ffffff;
  }

  .intercom-lightweight-app-messenger-footer{
    position:absolute;
    bottom:0;
    width: 100%;
    height: 80px;
    background: #ffffff;
    font-size: 14px;
    line-height: 21px;
    border-top: 1px solid rgba(0, 0, 0, 0.05);
    box-shadow: 0px 0px 25px rgba(0, 0, 0, 0.05);
  }

  @media print {
    .intercom-lightweight-app {
      display: none;
    }
  }


Phase 1 through 4 are complete in the workspace. Build Phase 5 (frontend) now. Then run the quality checklist against every file and fix any violations.