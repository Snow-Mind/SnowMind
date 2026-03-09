2026-03-09T14:38:56.376623858Z [err]  Installed 6 packages in 20ms
2026-03-09T14:38:56.376628825Z [err]  Bytecode compiled 1822 files in 134ms
2026-03-09T14:38:56.436146938Z [inf]  Starting Container
2026-03-09T14:38:57.245395838Z [err]    File "/usr/local/lib/python3.12/json/decoder.py", line 338, in decode
2026-03-09T14:38:57.245411009Z [err]      obj, end = self.raw_decode(s, idx=_w(s, 0).end())
2026-03-09T14:38:57.245412552Z [err]  Traceback (most recent call last):
2026-03-09T14:38:57.245419539Z [err]                 ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
2026-03-09T14:38:57.245419635Z [err]    File "/app/.venv/lib/python3.12/site-packages/pydantic_settings/sources.py", line 552, in __call__
2026-03-09T14:38:57.245426212Z [err]    File "/usr/local/lib/python3.12/json/decoder.py", line 356, in raw_decode
2026-03-09T14:38:57.245426350Z [err]      field_value = self.prepare_field_value(field_name, field, field_value, value_is_complex)
2026-03-09T14:38:57.245433040Z [err]                    ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
2026-03-09T14:38:57.245437778Z [err]    File "/app/.venv/lib/python3.12/site-packages/pydantic_settings/sources.py", line 764, in prepare_field_value
2026-03-09T14:38:57.245441794Z [err]      raise e
2026-03-09T14:38:57.245445750Z [err]    File "/app/.venv/lib/python3.12/site-packages/pydantic_settings/sources.py", line 761, in prepare_field_value
2026-03-09T14:38:57.245449998Z [err]      value = self.decode_complex_value(field_name, field, value)
2026-03-09T14:38:57.245454661Z [err]              ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
2026-03-09T14:38:57.245459008Z [err]    File "/app/.venv/lib/python3.12/site-packages/pydantic_settings/sources.py", line 312, in decode_complex_value
2026-03-09T14:38:57.245463518Z [err]      return json.loads(value)
2026-03-09T14:38:57.245468172Z [err]             ^^^^^^^^^^^^^^^^^
2026-03-09T14:38:57.245472183Z [err]    File "/usr/local/lib/python3.12/json/__init__.py", line 346, in loads
2026-03-09T14:38:57.245475952Z [err]      return _default_decoder.decode(s)
2026-03-09T14:38:57.245480428Z [err]             ^^^^^^^^^^^^^^^^^^^^^^^^^^
2026-03-09T14:38:57.245972611Z [err]             ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
2026-03-09T14:38:57.245980966Z [err]    File "/app/.venv/lib/python3.12/site-packages/click/core.py", line 824, in invoke
2026-03-09T14:38:57.245982172Z [err]             ^^^^^^^^^^^^^^^^^^^^^^^^^^
2026-03-09T14:38:57.245987116Z [err]      return callback(*args, **kwargs)
2026-03-09T14:38:57.245992895Z [err]    File "/app/.venv/lib/python3.12/site-packages/click/core.py", line 1406, in main
2026-03-09T14:38:57.245995005Z [err]             ^^^^^^^^^^^^^^^^^^^^^^^^^
2026-03-09T14:38:57.245996684Z [err]      raise JSONDecodeError("Expecting value", s, err.value) from None
2026-03-09T14:38:57.246002686Z [err]      rv = self.invoke(ctx)
2026-03-09T14:38:57.246002976Z [err]    File "/app/.venv/lib/python3.12/site-packages/uvicorn/main.py", line 412, in main
2026-03-09T14:38:57.246009216Z [err]  json.decoder.JSONDecodeError: Expecting value: line 1 column 1 (char 0)
2026-03-09T14:38:57.246011606Z [err]           ^^^^^^^^^^^^^^^^
2026-03-09T14:38:57.246011705Z [err]      run(
2026-03-09T14:38:57.246020141Z [err]    File "/app/.venv/lib/python3.12/site-packages/click/core.py", line 1269, in invoke
2026-03-09T14:38:57.246021190Z [err]  
2026-03-09T14:38:57.246027336Z [err]      return ctx.invoke(self.callback, **ctx.params)
2026-03-09T14:38:57.246028273Z [err]  The above exception was the direct cause of the following exception:
2026-03-09T14:38:57.246034221Z [err]  
2026-03-09T14:38:57.246041435Z [err]  Traceback (most recent call last):
2026-03-09T14:38:57.246046866Z [err]    File "/app/.venv/bin/uvicorn", line 10, in <module>
2026-03-09T14:38:57.246052318Z [err]      sys.exit(main())
2026-03-09T14:38:57.246057604Z [err]               ^^^^^^
2026-03-09T14:38:57.246063113Z [err]    File "/app/.venv/lib/python3.12/site-packages/click/core.py", line 1485, in __call__
2026-03-09T14:38:57.246069581Z [err]      return self.main(*args, **kwargs)
2026-03-09T14:38:57.246432116Z [err]    File "/app/.venv/lib/python3.12/site-packages/uvicorn/main.py", line 579, in run
2026-03-09T14:38:57.246442494Z [err]      server.run()
2026-03-09T14:38:57.246448150Z [err]    File "/app/.venv/lib/python3.12/site-packages/uvicorn/server.py", line 65, in run
2026-03-09T14:38:57.246452723Z [err]      return asyncio.run(self.serve(sockets=sockets))
2026-03-09T14:38:57.246458696Z [err]             ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
2026-03-09T14:38:57.246463654Z [err]    File "/usr/local/lib/python3.12/asyncio/runners.py", line 195, in run
2026-03-09T14:38:57.246468319Z [err]      return runner.run(main)
2026-03-09T14:38:57.246472546Z [err]             ^^^^^^^^^^^^^^^^
2026-03-09T14:38:57.246477634Z [err]    File "/usr/local/lib/python3.12/asyncio/runners.py", line 118, in run
2026-03-09T14:38:57.246483151Z [err]      return self._loop.run_until_complete(task)
2026-03-09T14:38:57.246487922Z [err]             ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
2026-03-09T14:38:57.246494526Z [err]    File "uvloop/loop.pyx", line 1518, in uvloop.loop.Loop.run_until_complete
2026-03-09T14:38:57.246499404Z [err]    File "/app/.venv/lib/python3.12/site-packages/uvicorn/server.py", line 69, in serve
2026-03-09T14:38:57.246504856Z [err]      await self._serve(sockets)
2026-03-09T14:38:57.246509609Z [err]    File "/app/.venv/lib/python3.12/site-packages/uvicorn/server.py", line 76, in _serve
2026-03-09T14:38:57.246514478Z [err]      config.load()
2026-03-09T14:38:57.246519222Z [err]    File "/app/.venv/lib/python3.12/site-packages/uvicorn/config.py", line 434, in load
2026-03-09T14:38:57.246524640Z [err]      self.loaded_app = import_from_string(self.app)
2026-03-09T14:38:57.246726400Z [err]                        ^^^^^^^^^^^^^^^^^^^^^^^^^^^^
2026-03-09T14:38:57.246733614Z [err]    File "/app/.venv/lib/python3.12/site-packages/uvicorn/importer.py", line 19, in import_from_string
2026-03-09T14:38:57.247176298Z [err]      module = importlib.import_module(module_str)
2026-03-09T14:38:57.247183537Z [err]    File "<frozen importlib._bootstrap>", line 1331, in _find_and_load_unlocked
2026-03-09T14:38:57.247186595Z [err]               ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
2026-03-09T14:38:57.247191208Z [err]      settings = get_settings()
2026-03-09T14:38:57.247192182Z [err]    File "<frozen importlib._bootstrap>", line 935, in _load_unlocked
2026-03-09T14:38:57.247195309Z [err]    File "/usr/local/lib/python3.12/importlib/__init__.py", line 90, in import_module
2026-03-09T14:38:57.247197656Z [err]    File "/app/app/api/routes/accounts.py", line 13, in <module>
2026-03-09T14:38:57.247202324Z [err]                 ^^^^^^^^^^^^^^
2026-03-09T14:38:57.247203501Z [err]    File "<frozen importlib._bootstrap_external>", line 999, in exec_module
2026-03-09T14:38:57.247206717Z [err]      return _bootstrap._gcd_import(name[level:], package, level)
2026-03-09T14:38:57.247208274Z [err]      from app.core.database import get_db
2026-03-09T14:38:57.247211392Z [err]    File "<frozen importlib._bootstrap>", line 488, in _call_with_frames_removed
2026-03-09T14:38:57.247214326Z [err]             ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
2026-03-09T14:38:57.247216894Z [err]    File "/app/app/core/database.py", line 9, in <module>
2026-03-09T14:38:57.247218687Z [err]    File "/app/main.py", line 16, in <module>
2026-03-09T14:38:57.247223181Z [err]    File "<frozen importlib._bootstrap>", line 1387, in _gcd_import
2026-03-09T14:38:57.247225940Z [err]      from app.core.config import get_settings
2026-03-09T14:38:57.247227101Z [err]      from app.api.routes import accounts, health, optimizer, portfolio, rebalance
2026-03-09T14:38:57.247230016Z [err]    File "<frozen importlib._bootstrap>", line 1360, in _find_and_load
2026-03-09T14:38:57.247234083Z [err]    File "/app/app/core/config.py", line 103, in <module>
2026-03-09T14:38:57.247553717Z [err]    File "/app/app/core/config.py", line 99, in get_settings
2026-03-09T14:38:57.247559118Z [err]      return Settings()
2026-03-09T14:38:57.247563366Z [err]             ^^^^^^^^^^
2026-03-09T14:38:57.247569718Z [err]    File "/app/.venv/lib/python3.12/site-packages/pydantic_settings/main.py", line 168, in __init__
2026-03-09T14:38:57.247575200Z [err]      **__pydantic_self__._settings_build_values(
2026-03-09T14:38:57.247579794Z [err]        ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
2026-03-09T14:38:57.247583800Z [err]    File "/app/.venv/lib/python3.12/site-packages/pydantic_settings/main.py", line 386, in _settings_build_values
2026-03-09T14:38:57.247587717Z [err]      source_state = source()
2026-03-09T14:38:57.247591617Z [err]                     ^^^^^^^^
2026-03-09T14:38:57.247595438Z [err]    File "/app/.venv/lib/python3.12/site-packages/pydantic_settings/sources.py", line 554, in __call__
2026-03-09T14:38:57.247599877Z [err]      raise SettingsError(
2026-03-09T14:38:57.247604277Z [err]  pydantic_settings.sources.SettingsError: error parsing value for field "ALLOWED_ORIGINS" from source "EnvSettingsSource"
2026-03-09T14:38:58.021737565Z [err]  Bytecode compiled 1822 files in 64ms
2026-03-09T14:38:58.558517580Z [err]  Traceback (most recent call last):
2026-03-09T14:38:58.558525495Z [err]             ^^^^^^^^^^^^^^^^^^^^^^^^^^
2026-03-09T14:38:58.558526141Z [err]    File "/app/.venv/lib/python3.12/site-packages/pydantic_settings/sources.py", line 552, in __call__
2026-03-09T14:38:58.558532677Z [err]      field_value = self.prepare_field_value(field_name, field, field_value, value_is_complex)
2026-03-09T14:38:58.558535798Z [err]    File "/usr/local/lib/python3.12/json/decoder.py", line 338, in decode
2026-03-09T14:38:58.558538926Z [err]                    ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
2026-03-09T14:38:58.558542959Z [err]      obj, end = self.raw_decode(s, idx=_w(s, 0).end())
2026-03-09T14:38:58.558545843Z [err]    File "/app/.venv/lib/python3.12/site-packages/pydantic_settings/sources.py", line 764, in prepare_field_value
2026-03-09T14:38:58.558550503Z [err]                 ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
2026-03-09T14:38:58.558552146Z [err]      raise e
2026-03-09T14:38:58.558558072Z [err]    File "/app/.venv/lib/python3.12/site-packages/pydantic_settings/sources.py", line 761, in prepare_field_value
2026-03-09T14:38:58.558558173Z [err]    File "/usr/local/lib/python3.12/json/decoder.py", line 356, in raw_decode
2026-03-09T14:38:58.558566615Z [err]      value = self.decode_complex_value(field_name, field, value)
2026-03-09T14:38:58.558573402Z [err]              ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
2026-03-09T14:38:58.558579844Z [err]    File "/app/.venv/lib/python3.12/site-packages/pydantic_settings/sources.py", line 312, in decode_complex_value
2026-03-09T14:38:58.558585906Z [err]      return json.loads(value)
2026-03-09T14:38:58.558592392Z [err]             ^^^^^^^^^^^^^^^^^
2026-03-09T14:38:58.558598913Z [err]    File "/usr/local/lib/python3.12/json/__init__.py", line 346, in loads
2026-03-09T14:38:58.558604947Z [err]      return _default_decoder.decode(s)
2026-03-09T14:38:58.559011674Z [err]      raise JSONDecodeError("Expecting value", s, err.value) from None
2026-03-09T14:38:58.559017363Z [err]      return ctx.invoke(self.callback, **ctx.params)
2026-03-09T14:38:58.559020630Z [err]  json.decoder.JSONDecodeError: Expecting value: line 1 column 1 (char 0)
2026-03-09T14:38:58.559026953Z [err]             ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
2026-03-09T14:38:58.559027063Z [err]  
2026-03-09T14:38:58.559035233Z [err]  The above exception was the direct cause of the following exception:
2026-03-09T14:38:58.559037826Z [err]    File "/app/.venv/lib/python3.12/site-packages/click/core.py", line 824, in invoke
2026-03-09T14:38:58.559042321Z [err]  
2026-03-09T14:38:58.559044882Z [err]      return callback(*args, **kwargs)
2026-03-09T14:38:58.559048802Z [err]  Traceback (most recent call last):
2026-03-09T14:38:58.559053234Z [err]             ^^^^^^^^^^^^^^^^^^^^^^^^^
2026-03-09T14:38:58.559054781Z [err]    File "/app/.venv/bin/uvicorn", line 10, in <module>
2026-03-09T14:38:58.559060516Z [err]      sys.exit(main())
2026-03-09T14:38:58.559063051Z [err]    File "/app/.venv/lib/python3.12/site-packages/uvicorn/main.py", line 412, in main
2026-03-09T14:38:58.559067041Z [err]               ^^^^^^
2026-03-09T14:38:58.559072362Z [err]      run(
2026-03-09T14:38:58.559074768Z [err]    File "/app/.venv/lib/python3.12/site-packages/click/core.py", line 1485, in __call__
2026-03-09T14:38:58.559079548Z [err]      return self.main(*args, **kwargs)
2026-03-09T14:38:58.559083704Z [err]             ^^^^^^^^^^^^^^^^^^^^^^^^^^
2026-03-09T14:38:58.559088088Z [err]    File "/app/.venv/lib/python3.12/site-packages/click/core.py", line 1406, in main
2026-03-09T14:38:58.559092388Z [err]      rv = self.invoke(ctx)
2026-03-09T14:38:58.559099501Z [err]           ^^^^^^^^^^^^^^^^
2026-03-09T14:38:58.559104237Z [err]    File "/app/.venv/lib/python3.12/site-packages/click/core.py", line 1269, in invoke
2026-03-09T14:38:58.559476723Z [err]    File "/app/.venv/lib/python3.12/site-packages/uvicorn/main.py", line 579, in run
2026-03-09T14:38:58.559480556Z [err]    File "/app/.venv/lib/python3.12/site-packages/uvicorn/server.py", line 76, in _serve
2026-03-09T14:38:58.559483770Z [err]      server.run()
2026-03-09T14:38:58.559489682Z [err]    File "/app/.venv/lib/python3.12/site-packages/uvicorn/server.py", line 65, in run
2026-03-09T14:38:58.559490158Z [err]      config.load()
2026-03-09T14:38:58.559495197Z [err]      return asyncio.run(self.serve(sockets=sockets))
2026-03-09T14:38:58.559497014Z [err]    File "/app/.venv/lib/python3.12/site-packages/uvicorn/config.py", line 434, in load
2026-03-09T14:38:58.559501104Z [err]             ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
2026-03-09T14:38:58.559503339Z [err]      self.loaded_app = import_from_string(self.app)
2026-03-09T14:38:58.559508809Z [err]    File "/usr/local/lib/python3.12/asyncio/runners.py", line 195, in run
2026-03-09T14:38:58.559510680Z [err]                        ^^^^^^^^^^^^^^^^^^^^^^^^^^^^
2026-03-09T14:38:58.559514851Z [err]      return runner.run(main)
2026-03-09T14:38:58.559517046Z [err]    File "/app/.venv/lib/python3.12/site-packages/uvicorn/importer.py", line 19, in import_from_string
2026-03-09T14:38:58.559520631Z [err]             ^^^^^^^^^^^^^^^^
2026-03-09T14:38:58.559525104Z [err]    File "/usr/local/lib/python3.12/asyncio/runners.py", line 118, in run
2026-03-09T14:38:58.559530514Z [err]      return self._loop.run_until_complete(task)
2026-03-09T14:38:58.559534831Z [err]             ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
2026-03-09T14:38:58.559539167Z [err]    File "uvloop/loop.pyx", line 1518, in uvloop.loop.Loop.run_until_complete
2026-03-09T14:38:58.559543119Z [err]    File "/app/.venv/lib/python3.12/site-packages/uvicorn/server.py", line 69, in serve
2026-03-09T14:38:58.559547297Z [err]      await self._serve(sockets)
2026-03-09T14:38:58.560059063Z [err]    File "/app/app/api/routes/accounts.py", line 13, in <module>
2026-03-09T14:38:58.560060631Z [err]      module = importlib.import_module(module_str)
2026-03-09T14:38:58.560065345Z [err]      from app.core.database import get_db
2026-03-09T14:38:58.560068506Z [err]               ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
2026-03-09T14:38:58.560072153Z [err]    File "/app/app/core/database.py", line 9, in <module>
2026-03-09T14:38:58.560074576Z [err]    File "/usr/local/lib/python3.12/importlib/__init__.py", line 90, in import_module
2026-03-09T14:38:58.560078829Z [err]      from app.core.config import get_settings
2026-03-09T14:38:58.560081531Z [err]      return _bootstrap._gcd_import(name[level:], package, level)
2026-03-09T14:38:58.560084338Z [err]    File "/app/app/core/config.py", line 103, in <module>
2026-03-09T14:38:58.560089615Z [err]             ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
2026-03-09T14:38:58.560090352Z [err]      settings = get_settings()
2026-03-09T14:38:58.560095922Z [err]    File "<frozen importlib._bootstrap>", line 1387, in _gcd_import
2026-03-09T14:38:58.560097409Z [err]                 ^^^^^^^^^^^^^^
2026-03-09T14:38:58.560101169Z [err]    File "<frozen importlib._bootstrap>", line 1360, in _find_and_load
2026-03-09T14:38:58.560105218Z [err]    File "<frozen importlib._bootstrap>", line 1331, in _find_and_load_unlocked
2026-03-09T14:38:58.560109300Z [err]    File "<frozen importlib._bootstrap>", line 935, in _load_unlocked
2026-03-09T14:38:58.560113388Z [err]    File "<frozen importlib._bootstrap_external>", line 999, in exec_module
2026-03-09T14:38:58.560117501Z [err]    File "<frozen importlib._bootstrap>", line 488, in _call_with_frames_removed
2026-03-09T14:38:58.560122149Z [err]    File "/app/main.py", line 16, in <module>
2026-03-09T14:38:58.560126186Z [err]      from app.api.routes import accounts, health, optimizer, portfolio, rebalance
2026-03-09T14:38:58.560510068Z [err]  pydantic_settings.sources.SettingsError: error parsing value for field "ALLOWED_ORIGINS" from source "EnvSettingsSource"
2026-03-09T14:38:58.560520291Z [err]    File "/app/app/core/config.py", line 99, in get_settings
2026-03-09T14:38:58.560527900Z [err]      return Settings()
2026-03-09T14:38:58.560532337Z [err]             ^^^^^^^^^^
2026-03-09T14:38:58.560536776Z [err]    File "/app/.venv/lib/python3.12/site-packages/pydantic_settings/main.py", line 168, in __init__
2026-03-09T14:38:58.560542296Z [err]      **__pydantic_self__._settings_build_values(
2026-03-09T14:38:58.560548218Z [err]        ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
2026-03-09T14:38:58.560553818Z [err]    File "/app/.venv/lib/python3.12/site-packages/pydantic_settings/main.py", line 386, in _settings_build_values
2026-03-09T14:38:58.560559261Z [err]      source_state = source()
2026-03-09T14:38:58.560564811Z [err]                     ^^^^^^^^
2026-03-09T14:38:58.560570629Z [err]    File "/app/.venv/lib/python3.12/site-packages/pydantic_settings/sources.py", line 554, in __call__
2026-03-09T14:38:58.560576793Z [err]      raise SettingsError(
2026-03-09T14:38:59.261058414Z [err]  Bytecode compiled 1822 files in 82ms
2026-03-09T14:38:59.827015682Z [err]    File "/usr/local/lib/python3.12/json/decoder.py", line 338, in decode
2026-03-09T14:38:59.827025403Z [err]      obj, end = self.raw_decode(s, idx=_w(s, 0).end())
2026-03-09T14:38:59.827031350Z [err]                 ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
2026-03-09T14:38:59.827037506Z [err]    File "/usr/local/lib/python3.12/json/decoder.py", line 356, in raw_decode
2026-03-09T14:38:59.827039092Z [err]  Traceback (most recent call last):
2026-03-09T14:38:59.827044854Z [err]    File "/app/.venv/lib/python3.12/site-packages/pydantic_settings/sources.py", line 552, in __call__
2026-03-09T14:38:59.827050568Z [err]      field_value = self.prepare_field_value(field_name, field, field_value, value_is_complex)
2026-03-09T14:38:59.827055321Z [err]                    ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
2026-03-09T14:38:59.827061232Z [err]    File "/app/.venv/lib/python3.12/site-packages/pydantic_settings/sources.py", line 764, in prepare_field_value
2026-03-09T14:38:59.827066195Z [err]      raise e
2026-03-09T14:38:59.827070552Z [err]    File "/app/.venv/lib/python3.12/site-packages/pydantic_settings/sources.py", line 761, in prepare_field_value
2026-03-09T14:38:59.827075080Z [err]      value = self.decode_complex_value(field_name, field, value)
2026-03-09T14:38:59.827080032Z [err]              ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
2026-03-09T14:38:59.827085196Z [err]    File "/app/.venv/lib/python3.12/site-packages/pydantic_settings/sources.py", line 312, in decode_complex_value
2026-03-09T14:38:59.827090039Z [err]      return json.loads(value)
2026-03-09T14:38:59.827094986Z [err]             ^^^^^^^^^^^^^^^^^
2026-03-09T14:38:59.827099865Z [err]    File "/usr/local/lib/python3.12/json/__init__.py", line 346, in loads
2026-03-09T14:38:59.827104620Z [err]      return _default_decoder.decode(s)
2026-03-09T14:38:59.827109311Z [err]             ^^^^^^^^^^^^^^^^^^^^^^^^^^
2026-03-09T14:38:59.827663082Z [err]      raise JSONDecodeError("Expecting value", s, err.value) from None
2026-03-09T14:38:59.827670632Z [err]  json.decoder.JSONDecodeError: Expecting value: line 1 column 1 (char 0)
2026-03-09T14:38:59.827672204Z [err]      return callback(*args, **kwargs)
2026-03-09T14:38:59.827677691Z [err]  
2026-03-09T14:38:59.827680879Z [err]             ^^^^^^^^^^^^^^^^^^^^^^^^^
2026-03-09T14:38:59.827684397Z [err]  The above exception was the direct cause of the following exception:
2026-03-09T14:38:59.827688360Z [err]    File "/app/.venv/lib/python3.12/site-packages/click/core.py", line 1406, in main
2026-03-09T14:38:59.827689226Z [err]    File "/app/.venv/lib/python3.12/site-packages/uvicorn/main.py", line 412, in main
2026-03-09T14:38:59.827691995Z [err]  
2026-03-09T14:38:59.827698124Z [err]      run(
2026-03-09T14:38:59.827702474Z [err]      rv = self.invoke(ctx)
2026-03-09T14:38:59.827703194Z [err]  Traceback (most recent call last):
2026-03-09T14:38:59.827712657Z [err]           ^^^^^^^^^^^^^^^^
2026-03-09T14:38:59.827713321Z [err]    File "/app/.venv/bin/uvicorn", line 10, in <module>
2026-03-09T14:38:59.827719411Z [err]    File "/app/.venv/lib/python3.12/site-packages/click/core.py", line 1269, in invoke
2026-03-09T14:38:59.827724867Z [err]      sys.exit(main())
2026-03-09T14:38:59.827726478Z [err]      return ctx.invoke(self.callback, **ctx.params)
2026-03-09T14:38:59.827730939Z [err]               ^^^^^^
2026-03-09T14:38:59.827733299Z [err]             ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
2026-03-09T14:38:59.827737294Z [err]    File "/app/.venv/lib/python3.12/site-packages/click/core.py", line 1485, in __call__
2026-03-09T14:38:59.827740945Z [err]    File "/app/.venv/lib/python3.12/site-packages/click/core.py", line 824, in invoke
2026-03-09T14:38:59.827743841Z [err]      return self.main(*args, **kwargs)
2026-03-09T14:38:59.827749648Z [err]             ^^^^^^^^^^^^^^^^^^^^^^^^^^
2026-03-09T14:38:59.827878941Z [err]      self.loaded_app = import_from_string(self.app)
2026-03-09T14:38:59.827880001Z [err]    File "/app/.venv/lib/python3.12/site-packages/uvicorn/server.py", line 69, in serve
2026-03-09T14:38:59.827887140Z [err]                        ^^^^^^^^^^^^^^^^^^^^^^^^^^^^
2026-03-09T14:38:59.827887717Z [err]      await self._serve(sockets)
2026-03-09T14:38:59.827894217Z [err]    File "/app/.venv/lib/python3.12/site-packages/uvicorn/importer.py", line 19, in import_from_string
2026-03-09T14:38:59.827894759Z [err]    File "/app/.venv/lib/python3.12/site-packages/uvicorn/main.py", line 579, in run
2026-03-09T14:38:59.827897602Z [err]    File "/app/.venv/lib/python3.12/site-packages/uvicorn/server.py", line 76, in _serve
2026-03-09T14:38:59.827903379Z [err]      config.load()
2026-03-09T14:38:59.827904093Z [err]      server.run()
2026-03-09T14:38:59.827909012Z [err]    File "/app/.venv/lib/python3.12/site-packages/uvicorn/config.py", line 434, in load
2026-03-09T14:38:59.827912955Z [err]    File "/app/.venv/lib/python3.12/site-packages/uvicorn/server.py", line 65, in run
2026-03-09T14:38:59.827918102Z [err]      return asyncio.run(self.serve(sockets=sockets))
2026-03-09T14:38:59.827923356Z [err]             ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
2026-03-09T14:38:59.827929457Z [err]    File "/usr/local/lib/python3.12/asyncio/runners.py", line 195, in run
2026-03-09T14:38:59.827935603Z [err]      return runner.run(main)
2026-03-09T14:38:59.827940666Z [err]             ^^^^^^^^^^^^^^^^
2026-03-09T14:38:59.827945292Z [err]    File "/usr/local/lib/python3.12/asyncio/runners.py", line 118, in run
2026-03-09T14:38:59.827951395Z [err]      return self._loop.run_until_complete(task)
2026-03-09T14:38:59.827959034Z [err]             ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
2026-03-09T14:38:59.827964529Z [err]    File "uvloop/loop.pyx", line 1518, in uvloop.loop.Loop.run_until_complete
2026-03-09T14:38:59.828520311Z [err]      module = importlib.import_module(module_str)
2026-03-09T14:38:59.828527155Z [err]               ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
2026-03-09T14:38:59.828529526Z [err]      from app.core.database import get_db
2026-03-09T14:38:59.828533199Z [err]    File "/usr/local/lib/python3.12/importlib/__init__.py", line 90, in import_module
2026-03-09T14:38:59.828537033Z [err]    File "/app/app/core/database.py", line 9, in <module>
2026-03-09T14:38:59.828540411Z [err]      return _bootstrap._gcd_import(name[level:], package, level)
2026-03-09T14:38:59.828543570Z [err]      from app.core.config import get_settings
2026-03-09T14:38:59.828547019Z [err]             ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
2026-03-09T14:38:59.828549826Z [err]    File "/app/app/core/config.py", line 103, in <module>
2026-03-09T14:38:59.828553290Z [err]    File "<frozen importlib._bootstrap>", line 1387, in _gcd_import
2026-03-09T14:38:59.828556259Z [err]      settings = get_settings()
2026-03-09T14:38:59.828561406Z [err]    File "<frozen importlib._bootstrap>", line 1360, in _find_and_load
2026-03-09T14:38:59.828562576Z [err]                 ^^^^^^^^^^^^^^
2026-03-09T14:38:59.828572927Z [err]    File "<frozen importlib._bootstrap>", line 1331, in _find_and_load_unlocked
2026-03-09T14:38:59.828578340Z [err]    File "<frozen importlib._bootstrap>", line 935, in _load_unlocked
2026-03-09T14:38:59.828583705Z [err]    File "<frozen importlib._bootstrap_external>", line 999, in exec_module
2026-03-09T14:38:59.828589289Z [err]    File "<frozen importlib._bootstrap>", line 488, in _call_with_frames_removed
2026-03-09T14:38:59.828594774Z [err]    File "/app/main.py", line 16, in <module>
2026-03-09T14:38:59.828600218Z [err]      from app.api.routes import accounts, health, optimizer, portfolio, rebalance
2026-03-09T14:38:59.828604785Z [err]    File "/app/app/api/routes/accounts.py", line 13, in <module>
2026-03-09T14:38:59.829027925Z [err]    File "/app/app/core/config.py", line 99, in get_settings
2026-03-09T14:38:59.829033352Z [err]      return Settings()
2026-03-09T14:38:59.829037321Z [err]             ^^^^^^^^^^
2026-03-09T14:38:59.829041896Z [err]    File "/app/.venv/lib/python3.12/site-packages/pydantic_settings/main.py", line 168, in __init__
2026-03-09T14:38:59.829046309Z [err]      **__pydantic_self__._settings_build_values(
2026-03-09T14:38:59.829052067Z [err]        ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
2026-03-09T14:38:59.829056345Z [err]    File "/app/.venv/lib/python3.12/site-packages/pydantic_settings/main.py", line 386, in _settings_build_values
2026-03-09T14:38:59.829060408Z [err]      source_state = source()
2026-03-09T14:38:59.829064291Z [err]                     ^^^^^^^^
2026-03-09T14:38:59.829068410Z [err]    File "/app/.venv/lib/python3.12/site-packages/pydantic_settings/sources.py", line 554, in __call__
2026-03-09T14:38:59.829072998Z [err]      raise SettingsError(
2026-03-09T14:38:59.829077541Z [err]  pydantic_settings.sources.SettingsError: error parsing value for field "ALLOWED_ORIGINS" from source "EnvSettingsSource"
2026-03-09T14:39:00.465760394Z [err]  Bytecode compiled 1822 files in 88ms
2026-03-09T14:39:01.094288740Z [err]    File "/usr/local/lib/python3.12/json/decoder.py", line 356, in raw_decode
2026-03-09T14:39:01.094289642Z [err]  Traceback (most recent call last):
2026-03-09T14:39:01.094297528Z [err]    File "/app/.venv/lib/python3.12/site-packages/pydantic_settings/sources.py", line 552, in __call__
2026-03-09T14:39:01.094302445Z [err]      field_value = self.prepare_field_value(field_name, field, field_value, value_is_complex)
2026-03-09T14:39:01.094307884Z [err]                    ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
2026-03-09T14:39:01.094313574Z [err]    File "/app/.venv/lib/python3.12/site-packages/pydantic_settings/sources.py", line 764, in prepare_field_value
2026-03-09T14:39:01.094318234Z [err]      raise e
2026-03-09T14:39:01.094323319Z [err]    File "/app/.venv/lib/python3.12/site-packages/pydantic_settings/sources.py", line 761, in prepare_field_value
2026-03-09T14:39:01.094327788Z [err]      value = self.decode_complex_value(field_name, field, value)
2026-03-09T14:39:01.094332157Z [err]              ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
2026-03-09T14:39:01.094336625Z [err]    File "/app/.venv/lib/python3.12/site-packages/pydantic_settings/sources.py", line 312, in decode_complex_value
2026-03-09T14:39:01.094341757Z [err]      return json.loads(value)
2026-03-09T14:39:01.094346290Z [err]             ^^^^^^^^^^^^^^^^^
2026-03-09T14:39:01.094350751Z [err]    File "/usr/local/lib/python3.12/json/__init__.py", line 346, in loads
2026-03-09T14:39:01.094354977Z [err]      return _default_decoder.decode(s)
2026-03-09T14:39:01.094359302Z [err]             ^^^^^^^^^^^^^^^^^^^^^^^^^^
2026-03-09T14:39:01.094364021Z [err]    File "/usr/local/lib/python3.12/json/decoder.py", line 338, in decode
2026-03-09T14:39:01.094368671Z [err]      obj, end = self.raw_decode(s, idx=_w(s, 0).end())
2026-03-09T14:39:01.094373440Z [err]                 ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
2026-03-09T14:39:01.094865509Z [err]           ^^^^^^^^^^^^^^^^
2026-03-09T14:39:01.094875393Z [err]    File "/app/.venv/lib/python3.12/site-packages/click/core.py", line 1269, in invoke
2026-03-09T14:39:01.094883515Z [err]      return ctx.invoke(self.callback, **ctx.params)
2026-03-09T14:39:01.094885752Z [err]      raise JSONDecodeError("Expecting value", s, err.value) from None
2026-03-09T14:39:01.094889467Z [err]             ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
2026-03-09T14:39:01.094893111Z [err]  json.decoder.JSONDecodeError: Expecting value: line 1 column 1 (char 0)
2026-03-09T14:39:01.094896728Z [err]    File "/app/.venv/lib/python3.12/site-packages/click/core.py", line 824, in invoke
2026-03-09T14:39:01.094903423Z [err]  
2026-03-09T14:39:01.094903578Z [err]      return callback(*args, **kwargs)
2026-03-09T14:39:01.094910364Z [err]  The above exception was the direct cause of the following exception:
2026-03-09T14:39:01.094911157Z [err]             ^^^^^^^^^^^^^^^^^^^^^^^^^
2026-03-09T14:39:01.094917435Z [err]    File "/app/.venv/lib/python3.12/site-packages/uvicorn/main.py", line 412, in main
2026-03-09T14:39:01.094917983Z [err]  
2026-03-09T14:39:01.094925054Z [err]      run(
2026-03-09T14:39:01.094926805Z [err]  Traceback (most recent call last):
2026-03-09T14:39:01.094931399Z [err]    File "/app/.venv/bin/uvicorn", line 10, in <module>
2026-03-09T14:39:01.094936954Z [err]      sys.exit(main())
2026-03-09T14:39:01.094942842Z [err]               ^^^^^^
2026-03-09T14:39:01.094947378Z [err]    File "/app/.venv/lib/python3.12/site-packages/click/core.py", line 1485, in __call__
2026-03-09T14:39:01.094952121Z [err]      return self.main(*args, **kwargs)
2026-03-09T14:39:01.094956874Z [err]             ^^^^^^^^^^^^^^^^^^^^^^^^^^
2026-03-09T14:39:01.094961730Z [err]    File "/app/.venv/lib/python3.12/site-packages/click/core.py", line 1406, in main
2026-03-09T14:39:01.094966782Z [err]      rv = self.invoke(ctx)
2026-03-09T14:39:01.095247002Z [err]    File "/app/.venv/lib/python3.12/site-packages/uvicorn/main.py", line 579, in run
2026-03-09T14:39:01.095254599Z [err]    File "/app/.venv/lib/python3.12/site-packages/uvicorn/config.py", line 434, in load
2026-03-09T14:39:01.095254643Z [err]      server.run()
2026-03-09T14:39:01.095260790Z [err]    File "/app/.venv/lib/python3.12/site-packages/uvicorn/server.py", line 65, in run
2026-03-09T14:39:01.095265337Z [err]      return asyncio.run(self.serve(sockets=sockets))
2026-03-09T14:39:01.095270021Z [err]      self.loaded_app = import_from_string(self.app)
2026-03-09T14:39:01.095271578Z [err]             ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
2026-03-09T14:39:01.095277453Z [err]                        ^^^^^^^^^^^^^^^^^^^^^^^^^^^^
2026-03-09T14:39:01.095278095Z [err]    File "/usr/local/lib/python3.12/asyncio/runners.py", line 195, in run
2026-03-09T14:39:01.095284504Z [err]    File "/app/.venv/lib/python3.12/site-packages/uvicorn/importer.py", line 19, in import_from_string
2026-03-09T14:39:01.095285343Z [err]      return runner.run(main)
2026-03-09T14:39:01.095290950Z [err]             ^^^^^^^^^^^^^^^^
2026-03-09T14:39:01.095295644Z [err]    File "/usr/local/lib/python3.12/asyncio/runners.py", line 118, in run
2026-03-09T14:39:01.095303559Z [err]      return self._loop.run_until_complete(task)
2026-03-09T14:39:01.095309053Z [err]             ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
2026-03-09T14:39:01.095314202Z [err]    File "uvloop/loop.pyx", line 1518, in uvloop.loop.Loop.run_until_complete
2026-03-09T14:39:01.095318958Z [err]    File "/app/.venv/lib/python3.12/site-packages/uvicorn/server.py", line 69, in serve
2026-03-09T14:39:01.095323471Z [err]      await self._serve(sockets)
2026-03-09T14:39:01.095327877Z [err]    File "/app/.venv/lib/python3.12/site-packages/uvicorn/server.py", line 76, in _serve
2026-03-09T14:39:01.095332411Z [err]      config.load()
2026-03-09T14:39:01.095857117Z [err]      module = importlib.import_module(module_str)
2026-03-09T14:39:01.095862233Z [err]               ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
2026-03-09T14:39:01.095866850Z [err]    File "/usr/local/lib/python3.12/importlib/__init__.py", line 90, in import_module
2026-03-09T14:39:01.095871967Z [err]      return _bootstrap._gcd_import(name[level:], package, level)
2026-03-09T14:39:01.095877545Z [err]             ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
2026-03-09T14:39:01.095882017Z [err]    File "<frozen importlib._bootstrap>", line 1387, in _gcd_import
2026-03-09T14:39:01.095887637Z [err]    File "<frozen importlib._bootstrap>", line 1360, in _find_and_load
2026-03-09T14:39:01.095893015Z [err]    File "<frozen importlib._bootstrap>", line 1331, in _find_and_load_unlocked
2026-03-09T14:39:01.095897982Z [err]    File "<frozen importlib._bootstrap>", line 935, in _load_unlocked
2026-03-09T14:39:01.095903181Z [err]    File "<frozen importlib._bootstrap_external>", line 999, in exec_module
2026-03-09T14:39:01.095908046Z [err]    File "<frozen importlib._bootstrap>", line 488, in _call_with_frames_removed
2026-03-09T14:39:01.095913193Z [err]    File "/app/main.py", line 16, in <module>
2026-03-09T14:39:01.095917697Z [err]      from app.api.routes import accounts, health, optimizer, portfolio, rebalance
2026-03-09T14:39:01.095922079Z [err]    File "/app/app/api/routes/accounts.py", line 13, in <module>
2026-03-09T14:39:01.095927115Z [err]      from app.core.database import get_db
2026-03-09T14:39:01.095931445Z [err]    File "/app/app/core/database.py", line 9, in <module>
2026-03-09T14:39:01.095936537Z [err]      from app.core.config import get_settings
2026-03-09T14:39:01.095941222Z [err]    File "/app/app/core/config.py", line 103, in <module>
2026-03-09T14:39:01.095945619Z [err]      settings = get_settings()
2026-03-09T14:39:01.095950651Z [err]                 ^^^^^^^^^^^^^^
2026-03-09T14:39:01.096110328Z [err]    File "/app/app/core/config.py", line 99, in get_settings
2026-03-09T14:39:01.096116339Z [err]      return Settings()
2026-03-09T14:39:01.096121644Z [err]             ^^^^^^^^^^
2026-03-09T14:39:01.096125898Z [err]    File "/app/.venv/lib/python3.12/site-packages/pydantic_settings/main.py", line 168, in __init__
2026-03-09T14:39:01.096130450Z [err]      **__pydantic_self__._settings_build_values(
2026-03-09T14:39:01.096135199Z [err]        ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
2026-03-09T14:39:01.096141538Z [err]    File "/app/.venv/lib/python3.12/site-packages/pydantic_settings/main.py", line 386, in _settings_build_values
2026-03-09T14:39:01.096147222Z [err]      source_state = source()
2026-03-09T14:39:01.096151526Z [err]                     ^^^^^^^^
2026-03-09T14:39:01.096157245Z [err]    File "/app/.venv/lib/python3.12/site-packages/pydantic_settings/sources.py", line 554, in __call__
2026-03-09T14:39:01.096161435Z [err]      raise SettingsError(
2026-03-09T14:39:01.096166117Z [err]  pydantic_settings.sources.SettingsError: error parsing value for field "ALLOWED_ORIGINS" from source "EnvSettingsSource"