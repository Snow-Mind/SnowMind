2026-03-09T14:46:01.746489665Z [inf]  Starting Container
2026-03-09T14:46:02.466561965Z [err]  Installed 6 packages in 18ms
2026-03-09T14:46:02.466566416Z [err]  Bytecode compiled 1822 files in 157ms
2026-03-09T14:46:03.474583021Z [err]      self._core_schema = _getattr_no_parents(self._type, '__pydantic_core_schema__')
2026-03-09T14:46:03.474590758Z [err]  Traceback (most recent call last):
2026-03-09T14:46:03.474596938Z [err]    File "/app/.venv/lib/python3.12/site-packages/pydantic/type_adapter.py", line 270, in _init_core_attrs
2026-03-09T14:46:03.474597544Z [err]                          ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
2026-03-09T14:46:03.474605793Z [err]    File "/app/.venv/lib/python3.12/site-packages/pydantic/type_adapter.py", line 112, in _getattr_no_parents
2026-03-09T14:46:03.474612723Z [err]      raise AttributeError(attribute)
2026-03-09T14:46:03.474619046Z [err]  AttributeError: __pydantic_core_schema__
2026-03-09T14:46:03.474625128Z [err]  
2026-03-09T14:46:03.474631539Z [err]  During handling of the above exception, another exception occurred:
2026-03-09T14:46:03.474637083Z [err]  
2026-03-09T14:46:03.474643943Z [err]  Traceback (most recent call last):
2026-03-09T14:46:03.474651305Z [err]    File "/app/.venv/lib/python3.12/site-packages/pydantic/_internal/_generate_schema.py", line 864, in _resolve_forward_ref
2026-03-09T14:46:03.474659006Z [err]      obj = _typing_extra.eval_type_backport(obj, globalns=self._types_namespace)
2026-03-09T14:46:03.474666050Z [err]            ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
2026-03-09T14:46:03.474672660Z [err]    File "/app/.venv/lib/python3.12/site-packages/pydantic/_internal/_typing_extra.py", line 279, in eval_type_backport
2026-03-09T14:46:03.474679547Z [err]      return _eval_type_backport(value, globalns, localns, type_params)
2026-03-09T14:46:03.474686230Z [err]             ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
2026-03-09T14:46:03.474693118Z [err]    File "/app/.venv/lib/python3.12/site-packages/pydantic/_internal/_typing_extra.py", line 303, in _eval_type_backport
2026-03-09T14:46:03.475059455Z [err]      sys.exit(main())
2026-03-09T14:46:03.475065661Z [err]               ^^^^^^
2026-03-09T14:46:03.475071726Z [err]    File "/app/.venv/lib/python3.12/site-packages/click/core.py", line 1485, in __call__
2026-03-09T14:46:03.475072738Z [err]  NameError: name 'RegisterAccountRequest' is not defined
2026-03-09T14:46:03.475082805Z [err]  
2026-03-09T14:46:03.475091421Z [err]  The above exception was the direct cause of the following exception:
2026-03-09T14:46:03.475091475Z [err]      return _eval_type(value, globalns, localns, type_params)
2026-03-09T14:46:03.475098770Z [err]             ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
2026-03-09T14:46:03.475101943Z [err]  
2026-03-09T14:46:03.475106588Z [err]    File "/app/.venv/lib/python3.12/site-packages/pydantic/_internal/_typing_extra.py", line 332, in _eval_type
2026-03-09T14:46:03.475111315Z [err]  Traceback (most recent call last):
2026-03-09T14:46:03.475113866Z [err]      return typing._eval_type(  # type: ignore
2026-03-09T14:46:03.475120928Z [err]             ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
2026-03-09T14:46:03.475122176Z [err]    File "/app/.venv/bin/uvicorn", line 10, in <module>
2026-03-09T14:46:03.475126662Z [err]    File "/usr/local/lib/python3.12/typing.py", line 415, in _eval_type
2026-03-09T14:46:03.475133953Z [err]      return t._evaluate(globalns, localns, type_params, recursive_guard=recursive_guard)
2026-03-09T14:46:03.475138678Z [err]             ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
2026-03-09T14:46:03.475143425Z [err]    File "/usr/local/lib/python3.12/typing.py", line 947, in _evaluate
2026-03-09T14:46:03.475148033Z [err]      eval(self.__forward_code__, globalns, localns),
2026-03-09T14:46:03.475152581Z [err]      ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
2026-03-09T14:46:03.475157558Z [err]    File "<string>", line 1, in <module>
2026-03-09T14:46:03.475394690Z [err]      return runner.run(main)
2026-03-09T14:46:03.475399117Z [err]      server.run()
2026-03-09T14:46:03.475402927Z [err]             ^^^^^^^^^^^^^^^^
2026-03-09T14:46:03.475409098Z [err]    File "/app/.venv/lib/python3.12/site-packages/uvicorn/server.py", line 65, in run
2026-03-09T14:46:03.475410182Z [err]    File "/usr/local/lib/python3.12/asyncio/runners.py", line 118, in run
2026-03-09T14:46:03.475411021Z [err]      return self.main(*args, **kwargs)
2026-03-09T14:46:03.475417890Z [err]      return callback(*args, **kwargs)
2026-03-09T14:46:03.475418741Z [err]      return asyncio.run(self.serve(sockets=sockets))
2026-03-09T14:46:03.475428106Z [err]             ^^^^^^^^^^^^^^^^^^^^^^^^^^
2026-03-09T14:46:03.475428467Z [err]             ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
2026-03-09T14:46:03.475430376Z [err]             ^^^^^^^^^^^^^^^^^^^^^^^^^
2026-03-09T14:46:03.475438446Z [err]    File "/usr/local/lib/python3.12/asyncio/runners.py", line 195, in run
2026-03-09T14:46:03.475440520Z [err]    File "/app/.venv/lib/python3.12/site-packages/uvicorn/main.py", line 412, in main
2026-03-09T14:46:03.475441610Z [err]    File "/app/.venv/lib/python3.12/site-packages/click/core.py", line 1406, in main
2026-03-09T14:46:03.475450333Z [err]      run(
2026-03-09T14:46:03.475454637Z [err]      rv = self.invoke(ctx)
2026-03-09T14:46:03.475459146Z [err]    File "/app/.venv/lib/python3.12/site-packages/uvicorn/main.py", line 579, in run
2026-03-09T14:46:03.475465556Z [err]           ^^^^^^^^^^^^^^^^
2026-03-09T14:46:03.475475003Z [err]    File "/app/.venv/lib/python3.12/site-packages/click/core.py", line 1269, in invoke
2026-03-09T14:46:03.475484668Z [err]      return ctx.invoke(self.callback, **ctx.params)
2026-03-09T14:46:03.475508986Z [err]             ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
2026-03-09T14:46:03.475516168Z [err]    File "/app/.venv/lib/python3.12/site-packages/click/core.py", line 824, in invoke
2026-03-09T14:46:03.475758837Z [err]      return self._loop.run_until_complete(task)
2026-03-09T14:46:03.475766297Z [err]             ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
2026-03-09T14:46:03.475773386Z [err]    File "uvloop/loop.pyx", line 1518, in uvloop.loop.Loop.run_until_complete
2026-03-09T14:46:03.475786970Z [err]                        ^^^^^^^^^^^^^^^^^^^^^^^^^^^^
2026-03-09T14:46:03.475797232Z [err]    File "/app/.venv/lib/python3.12/site-packages/uvicorn/server.py", line 69, in serve
2026-03-09T14:46:03.475797827Z [err]    File "/app/.venv/lib/python3.12/site-packages/uvicorn/importer.py", line 19, in import_from_string
2026-03-09T14:46:03.475802912Z [err]      config.load()
2026-03-09T14:46:03.475804336Z [err]    File "/usr/local/lib/python3.12/importlib/__init__.py", line 90, in import_module
2026-03-09T14:46:03.475809020Z [err]      module = importlib.import_module(module_str)
2026-03-09T14:46:03.475811005Z [err]      await self._serve(sockets)
2026-03-09T14:46:03.475811343Z [err]    File "<frozen importlib._bootstrap>", line 1360, in _find_and_load
2026-03-09T14:46:03.475816300Z [err]    File "/app/.venv/lib/python3.12/site-packages/uvicorn/config.py", line 434, in load
2026-03-09T14:46:03.475819198Z [err]      return _bootstrap._gcd_import(name[level:], package, level)
2026-03-09T14:46:03.475819821Z [err]               ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
2026-03-09T14:46:03.475822314Z [err]    File "/app/.venv/lib/python3.12/site-packages/uvicorn/server.py", line 76, in _serve
2026-03-09T14:46:03.475823716Z [err]    File "<frozen importlib._bootstrap>", line 1331, in _find_and_load_unlocked
2026-03-09T14:46:03.475828356Z [err]      self.loaded_app = import_from_string(self.app)
2026-03-09T14:46:03.475830022Z [err]             ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
2026-03-09T14:46:03.475832936Z [err]    File "<frozen importlib._bootstrap>", line 935, in _load_unlocked
2026-03-09T14:46:03.475838229Z [err]    File "<frozen importlib._bootstrap>", line 1387, in _gcd_import
2026-03-09T14:46:03.476278899Z [err]    File "/app/.venv/lib/python3.12/site-packages/fastapi/dependencies/utils.py", line 277, in get_dependant
2026-03-09T14:46:03.476284883Z [err]    File "<frozen importlib._bootstrap_external>", line 999, in exec_module
2026-03-09T14:46:03.476286308Z [err]      self.add_api_route(
2026-03-09T14:46:03.476289678Z [err]      param_details = analyze_param(
2026-03-09T14:46:03.476294263Z [err]    File "<frozen importlib._bootstrap>", line 488, in _call_with_frames_removed
2026-03-09T14:46:03.476298770Z [err]                      ^^^^^^^^^^^^^^
2026-03-09T14:46:03.476300443Z [err]    File "/app/.venv/lib/python3.12/site-packages/fastapi/routing.py", line 931, in add_api_route
2026-03-09T14:46:03.476300974Z [err]    File "/app/main.py", line 16, in <module>
2026-03-09T14:46:03.476306063Z [err]    File "/app/.venv/lib/python3.12/site-packages/fastapi/dependencies/utils.py", line 478, in analyze_param
2026-03-09T14:46:03.476311479Z [err]      from app.api.routes import accounts, health, optimizer, portfolio, rebalance
2026-03-09T14:46:03.476312056Z [err]      route = route_class(
2026-03-09T14:46:03.476318853Z [err]    File "/app/app/api/routes/accounts.py", line 96, in <module>
2026-03-09T14:46:03.476321689Z [err]              ^^^^^^^^^^^^
2026-03-09T14:46:03.476326265Z [err]      @router.post("", response_model=AccountResponse, status_code=status.HTTP_201_CREATED)
2026-03-09T14:46:03.476330824Z [err]    File "/app/.venv/lib/python3.12/site-packages/fastapi/routing.py", line 552, in __init__
2026-03-09T14:46:03.476334262Z [err]       ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
2026-03-09T14:46:03.476340347Z [err]      self.dependant = get_dependant(path=self.path_format, call=self.endpoint)
2026-03-09T14:46:03.476340479Z [err]    File "/app/.venv/lib/python3.12/site-packages/fastapi/routing.py", line 992, in decorator
2026-03-09T14:46:03.476350660Z [err]                       ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
2026-03-09T14:46:03.476827425Z [err]      field = create_model_field(
2026-03-09T14:46:03.476837085Z [err]              ^^^^^^^^^^^^^^^^^^^
2026-03-09T14:46:03.476843210Z [err]    File "/app/.venv/lib/python3.12/site-packages/fastapi/utils.py", line 96, in create_model_field
2026-03-09T14:46:03.476848450Z [err]      return ModelField(**kwargs)  # type: ignore[arg-type]
2026-03-09T14:46:03.476854063Z [err]             ^^^^^^^^^^^^^^^^^^^^
2026-03-09T14:46:03.476859430Z [err]    File "<string>", line 6, in __init__
2026-03-09T14:46:03.476864264Z [err]    File "/app/.venv/lib/python3.12/site-packages/fastapi/_compat.py", line 110, in __post_init__
2026-03-09T14:46:03.476869673Z [err]      self._type_adapter: TypeAdapter[Any] = TypeAdapter(
2026-03-09T14:46:03.476875790Z [err]                                             ^^^^^^^^^^^^
2026-03-09T14:46:03.476881481Z [err]    File "/app/.venv/lib/python3.12/site-packages/pydantic/type_adapter.py", line 257, in __init__
2026-03-09T14:46:03.476886281Z [err]      self._init_core_attrs(rebuild_mocks=False)
2026-03-09T14:46:03.476891645Z [err]    File "/app/.venv/lib/python3.12/site-packages/pydantic/type_adapter.py", line 135, in wrapped
2026-03-09T14:46:03.476896288Z [err]      return func(self, *args, **kwargs)
2026-03-09T14:46:03.476901261Z [err]             ^^^^^^^^^^^^^^^^^^^^^^^^^^^
2026-03-09T14:46:03.476907984Z [err]    File "/app/.venv/lib/python3.12/site-packages/pydantic/type_adapter.py", line 277, in _init_core_attrs
2026-03-09T14:46:03.476915720Z [err]      self._core_schema = _get_schema(self._type, config_wrapper, parent_depth=self._parent_depth)
2026-03-09T14:46:03.476923030Z [err]                          ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
2026-03-09T14:46:03.476929662Z [err]    File "/app/.venv/lib/python3.12/site-packages/pydantic/type_adapter.py", line 95, in _get_schema
2026-03-09T14:46:03.476935709Z [err]      schema = gen.generate_schema(type_)
2026-03-09T14:46:03.477118844Z [err]               ^^^^^^^^^^^^^^^^^^^^^^^^^^
2026-03-09T14:46:03.477124597Z [err]    File "/app/.venv/lib/python3.12/site-packages/pydantic/_internal/_generate_schema.py", line 655, in generate_schema
2026-03-09T14:46:03.477129703Z [err]      schema = self._generate_schema_inner(obj)
2026-03-09T14:46:03.477134766Z [err]               ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
2026-03-09T14:46:03.477139389Z [err]    File "/app/.venv/lib/python3.12/site-packages/pydantic/_internal/_generate_schema.py", line 908, in _generate_schema_inner
2026-03-09T14:46:03.477144592Z [err]      return self._annotated_schema(obj)
2026-03-09T14:46:03.477150049Z [err]             ^^^^^^^^^^^^^^^^^^^^^^^^^^^
2026-03-09T14:46:03.477154711Z [err]    File "/app/.venv/lib/python3.12/site-packages/pydantic/_internal/_generate_schema.py", line 2024, in _annotated_schema
2026-03-09T14:46:03.477159303Z [err]      source_type, *annotations = self._get_args_resolving_forward_refs(
2026-03-09T14:46:03.477164098Z [err]                                  ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
2026-03-09T14:46:03.477169287Z [err]    File "/app/.venv/lib/python3.12/site-packages/pydantic/_internal/_generate_schema.py", line 886, in _get_args_resolving_forward_refs
2026-03-09T14:46:03.477174265Z [err]      args = tuple([self._resolve_forward_ref(a) if isinstance(a, ForwardRef) else a for a in args])
2026-03-09T14:46:03.477179426Z [err]                    ^^^^^^^^^^^^^^^^^^^^^^^^^^^^
2026-03-09T14:46:03.477184346Z [err]    File "/app/.venv/lib/python3.12/site-packages/pydantic/_internal/_generate_schema.py", line 866, in _resolve_forward_ref
2026-03-09T14:46:03.477189920Z [err]      raise PydanticUndefinedAnnotation.from_name_error(e) from e
2026-03-09T14:46:03.477194453Z [err]  pydantic.errors.PydanticUndefinedAnnotation: name 'RegisterAccountRequest' is not defined
2026-03-09T14:46:03.477199739Z [err]  
2026-03-09T14:46:03.477204988Z [err]  For further information visit https://errors.pydantic.dev/2.9/u/undefined-annotation
2026-03-09T14:46:04.064360064Z [err]  Bytecode compiled 1822 files in 69ms
2026-03-09T14:46:05.114403308Z [err]  Traceback (most recent call last):
2026-03-09T14:46:05.114407744Z [err]    File "/app/.venv/lib/python3.12/site-packages/pydantic/type_adapter.py", line 270, in _init_core_attrs
2026-03-09T14:46:05.114411869Z [err]      self._core_schema = _getattr_no_parents(self._type, '__pydantic_core_schema__')
2026-03-09T14:46:05.114416479Z [err]                          ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
2026-03-09T14:46:05.114421049Z [err]    File "/app/.venv/lib/python3.12/site-packages/pydantic/type_adapter.py", line 112, in _getattr_no_parents
2026-03-09T14:46:05.114425221Z [err]      raise AttributeError(attribute)
2026-03-09T14:46:05.114432721Z [err]  AttributeError: __pydantic_core_schema__
2026-03-09T14:46:05.114437037Z [err]  
2026-03-09T14:46:05.114441450Z [err]  During handling of the above exception, another exception occurred:
2026-03-09T14:46:05.114445826Z [err]  
2026-03-09T14:46:05.114450226Z [err]  Traceback (most recent call last):
2026-03-09T14:46:05.114454398Z [err]    File "/app/.venv/lib/python3.12/site-packages/pydantic/_internal/_generate_schema.py", line 864, in _resolve_forward_ref
2026-03-09T14:46:05.114458437Z [err]      obj = _typing_extra.eval_type_backport(obj, globalns=self._types_namespace)
2026-03-09T14:46:05.114463062Z [err]            ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
2026-03-09T14:46:05.114467381Z [err]    File "/app/.venv/lib/python3.12/site-packages/pydantic/_internal/_typing_extra.py", line 279, in eval_type_backport
2026-03-09T14:46:05.114471377Z [err]      return _eval_type_backport(value, globalns, localns, type_params)
2026-03-09T14:46:05.114476221Z [err]             ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
2026-03-09T14:46:05.114480435Z [err]    File "/app/.venv/lib/python3.12/site-packages/pydantic/_internal/_typing_extra.py", line 303, in _eval_type_backport
2026-03-09T14:46:05.114898990Z [err]      sys.exit(main())
2026-03-09T14:46:05.114905772Z [err]    File "/app/.venv/bin/uvicorn", line 10, in <module>
2026-03-09T14:46:05.114906198Z [err]      return _eval_type(value, globalns, localns, type_params)
2026-03-09T14:46:05.114908301Z [err]               ^^^^^^
2026-03-09T14:46:05.114916006Z [err]  
2026-03-09T14:46:05.114918294Z [err]    File "/app/.venv/lib/python3.12/site-packages/click/core.py", line 1485, in __call__
2026-03-09T14:46:05.114919433Z [err]             ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
2026-03-09T14:46:05.114926406Z [err]    File "/app/.venv/lib/python3.12/site-packages/pydantic/_internal/_typing_extra.py", line 332, in _eval_type
2026-03-09T14:46:05.114930476Z [err]  The above exception was the direct cause of the following exception:
2026-03-09T14:46:05.114933252Z [err]      return typing._eval_type(  # type: ignore
2026-03-09T14:46:05.114937699Z [err]  
2026-03-09T14:46:05.114940106Z [err]             ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
2026-03-09T14:46:05.114944744Z [err]  Traceback (most recent call last):
2026-03-09T14:46:05.114947526Z [err]    File "/usr/local/lib/python3.12/typing.py", line 415, in _eval_type
2026-03-09T14:46:05.114952409Z [err]      return t._evaluate(globalns, localns, type_params, recursive_guard=recursive_guard)
2026-03-09T14:46:05.114957582Z [err]             ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
2026-03-09T14:46:05.114962105Z [err]    File "/usr/local/lib/python3.12/typing.py", line 947, in _evaluate
2026-03-09T14:46:05.114967771Z [err]      eval(self.__forward_code__, globalns, localns),
2026-03-09T14:46:05.114972619Z [err]      ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
2026-03-09T14:46:05.114977665Z [err]    File "<string>", line 1, in <module>
2026-03-09T14:46:05.114983033Z [err]  NameError: name 'RegisterAccountRequest' is not defined
2026-03-09T14:46:05.115450131Z [err]      return self.main(*args, **kwargs)
2026-03-09T14:46:05.115458732Z [err]             ^^^^^^^^^^^^^^^^^^^^^^^^^^
2026-03-09T14:46:05.115461629Z [err]      return runner.run(main)
2026-03-09T14:46:05.115465516Z [err]    File "/app/.venv/lib/python3.12/site-packages/click/core.py", line 1406, in main
2026-03-09T14:46:05.115469343Z [err]             ^^^^^^^^^^^^^^^^
2026-03-09T14:46:05.115473075Z [err]      server.run()
2026-03-09T14:46:05.115473087Z [err]      rv = self.invoke(ctx)
2026-03-09T14:46:05.115476617Z [err]    File "/usr/local/lib/python3.12/asyncio/runners.py", line 118, in run
2026-03-09T14:46:05.115478735Z [err]             ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
2026-03-09T14:46:05.115483427Z [err]           ^^^^^^^^^^^^^^^^
2026-03-09T14:46:05.115483538Z [err]    File "/app/.venv/lib/python3.12/site-packages/uvicorn/server.py", line 65, in run
2026-03-09T14:46:05.115507049Z [err]    File "/app/.venv/lib/python3.12/site-packages/click/core.py", line 1269, in invoke
2026-03-09T14:46:05.115513635Z [err]      return asyncio.run(self.serve(sockets=sockets))
2026-03-09T14:46:05.115514711Z [err]      return ctx.invoke(self.callback, **ctx.params)
2026-03-09T14:46:05.115521051Z [err]    File "/app/.venv/lib/python3.12/site-packages/click/core.py", line 824, in invoke
2026-03-09T14:46:05.115522840Z [err]             ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
2026-03-09T14:46:05.115529857Z [err]    File "/usr/local/lib/python3.12/asyncio/runners.py", line 195, in run
2026-03-09T14:46:05.115531787Z [err]      return callback(*args, **kwargs)
2026-03-09T14:46:05.115538719Z [err]             ^^^^^^^^^^^^^^^^^^^^^^^^^
2026-03-09T14:46:05.115544826Z [err]    File "/app/.venv/lib/python3.12/site-packages/uvicorn/main.py", line 412, in main
2026-03-09T14:46:05.115551419Z [err]      run(
2026-03-09T14:46:05.115558539Z [err]    File "/app/.venv/lib/python3.12/site-packages/uvicorn/main.py", line 579, in run
2026-03-09T14:46:05.115904304Z [err]      return self._loop.run_until_complete(task)
2026-03-09T14:46:05.115911852Z [err]             ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
2026-03-09T14:46:05.115918429Z [err]    File "uvloop/loop.pyx", line 1518, in uvloop.loop.Loop.run_until_complete
2026-03-09T14:46:05.115926349Z [err]    File "/app/.venv/lib/python3.12/site-packages/uvicorn/server.py", line 69, in serve
2026-03-09T14:46:05.115932065Z [err]      await self._serve(sockets)
2026-03-09T14:46:05.115939099Z [err]    File "/app/.venv/lib/python3.12/site-packages/uvicorn/server.py", line 76, in _serve
2026-03-09T14:46:05.115944771Z [err]      config.load()
2026-03-09T14:46:05.115950264Z [err]    File "/app/.venv/lib/python3.12/site-packages/uvicorn/config.py", line 434, in load
2026-03-09T14:46:05.115955939Z [err]      self.loaded_app = import_from_string(self.app)
2026-03-09T14:46:05.115963178Z [err]                        ^^^^^^^^^^^^^^^^^^^^^^^^^^^^
2026-03-09T14:46:05.115968530Z [err]    File "/app/.venv/lib/python3.12/site-packages/uvicorn/importer.py", line 19, in import_from_string
2026-03-09T14:46:05.115972641Z [err]      module = importlib.import_module(module_str)
2026-03-09T14:46:05.115976931Z [err]               ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
2026-03-09T14:46:05.115981449Z [err]    File "/usr/local/lib/python3.12/importlib/__init__.py", line 90, in import_module
2026-03-09T14:46:05.115985834Z [err]      return _bootstrap._gcd_import(name[level:], package, level)
2026-03-09T14:46:05.115991460Z [err]             ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
2026-03-09T14:46:05.115996030Z [err]    File "<frozen importlib._bootstrap>", line 1387, in _gcd_import
2026-03-09T14:46:05.116000406Z [err]    File "<frozen importlib._bootstrap>", line 1360, in _find_and_load
2026-03-09T14:46:05.116004494Z [err]    File "<frozen importlib._bootstrap>", line 1331, in _find_and_load_unlocked
2026-03-09T14:46:05.116008544Z [err]    File "<frozen importlib._bootstrap>", line 935, in _load_unlocked
2026-03-09T14:46:05.116364998Z [err]                      ^^^^^^^^^^^^^^
2026-03-09T14:46:05.116373978Z [err]    File "/app/.venv/lib/python3.12/site-packages/fastapi/dependencies/utils.py", line 478, in analyze_param
2026-03-09T14:46:05.116377720Z [err]    File "<frozen importlib._bootstrap_external>", line 999, in exec_module
2026-03-09T14:46:05.116386093Z [err]    File "<frozen importlib._bootstrap>", line 488, in _call_with_frames_removed
2026-03-09T14:46:05.116391473Z [err]    File "/app/main.py", line 16, in <module>
2026-03-09T14:46:05.116397770Z [err]      from app.api.routes import accounts, health, optimizer, portfolio, rebalance
2026-03-09T14:46:05.116402668Z [err]    File "/app/app/api/routes/accounts.py", line 96, in <module>
2026-03-09T14:46:05.116407537Z [err]      @router.post("", response_model=AccountResponse, status_code=status.HTTP_201_CREATED)
2026-03-09T14:46:05.116413167Z [err]       ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
2026-03-09T14:46:05.116418221Z [err]    File "/app/.venv/lib/python3.12/site-packages/fastapi/routing.py", line 992, in decorator
2026-03-09T14:46:05.116423197Z [err]      self.add_api_route(
2026-03-09T14:46:05.116427569Z [err]    File "/app/.venv/lib/python3.12/site-packages/fastapi/routing.py", line 931, in add_api_route
2026-03-09T14:46:05.116432043Z [err]      route = route_class(
2026-03-09T14:46:05.116436235Z [err]              ^^^^^^^^^^^^
2026-03-09T14:46:05.116440581Z [err]    File "/app/.venv/lib/python3.12/site-packages/fastapi/routing.py", line 552, in __init__
2026-03-09T14:46:05.116444958Z [err]      self.dependant = get_dependant(path=self.path_format, call=self.endpoint)
2026-03-09T14:46:05.116449237Z [err]                       ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
2026-03-09T14:46:05.116453406Z [err]    File "/app/.venv/lib/python3.12/site-packages/fastapi/dependencies/utils.py", line 277, in get_dependant
2026-03-09T14:46:05.116462069Z [err]      param_details = analyze_param(
2026-03-09T14:46:05.116841238Z [err]      field = create_model_field(
2026-03-09T14:46:05.116847037Z [err]              ^^^^^^^^^^^^^^^^^^^
2026-03-09T14:46:05.116854096Z [err]    File "/app/.venv/lib/python3.12/site-packages/fastapi/utils.py", line 96, in create_model_field
2026-03-09T14:46:05.116856571Z [err]    File "/app/.venv/lib/python3.12/site-packages/pydantic/type_adapter.py", line 95, in _get_schema
2026-03-09T14:46:05.116861583Z [err]      return ModelField(**kwargs)  # type: ignore[arg-type]
2026-03-09T14:46:05.116864294Z [err]    File "/app/.venv/lib/python3.12/site-packages/pydantic/type_adapter.py", line 135, in wrapped
2026-03-09T14:46:05.116866536Z [err]      schema = gen.generate_schema(type_)
2026-03-09T14:46:05.116866789Z [err]    File "/app/.venv/lib/python3.12/site-packages/pydantic/type_adapter.py", line 277, in _init_core_attrs
2026-03-09T14:46:05.116872138Z [err]             ^^^^^^^^^^^^^^^^^^^^
2026-03-09T14:46:05.116877064Z [err]      return func(self, *args, **kwargs)
2026-03-09T14:46:05.116878155Z [err]      self._core_schema = _get_schema(self._type, config_wrapper, parent_depth=self._parent_depth)
2026-03-09T14:46:05.116882043Z [err]    File "<string>", line 6, in __init__
2026-03-09T14:46:05.116887065Z [err]             ^^^^^^^^^^^^^^^^^^^^^^^^^^^
2026-03-09T14:46:05.116888086Z [err]                          ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
2026-03-09T14:46:05.116896458Z [err]    File "/app/.venv/lib/python3.12/site-packages/fastapi/_compat.py", line 110, in __post_init__
2026-03-09T14:46:05.116906018Z [err]      self._type_adapter: TypeAdapter[Any] = TypeAdapter(
2026-03-09T14:46:05.116914732Z [err]                                             ^^^^^^^^^^^^
2026-03-09T14:46:05.116922058Z [err]    File "/app/.venv/lib/python3.12/site-packages/pydantic/type_adapter.py", line 257, in __init__
2026-03-09T14:46:05.116928412Z [err]      self._init_core_attrs(rebuild_mocks=False)
2026-03-09T14:46:05.117105141Z [err]               ^^^^^^^^^^^^^^^^^^^^^^^^^^
2026-03-09T14:46:05.117110024Z [err]    File "/app/.venv/lib/python3.12/site-packages/pydantic/_internal/_generate_schema.py", line 2024, in _annotated_schema
2026-03-09T14:46:05.117113887Z [err]  
2026-03-09T14:46:05.117116541Z [err]    File "/app/.venv/lib/python3.12/site-packages/pydantic/_internal/_generate_schema.py", line 655, in generate_schema
2026-03-09T14:46:05.117117938Z [err]      source_type, *annotations = self._get_args_resolving_forward_refs(
2026-03-09T14:46:05.117123195Z [err]      args = tuple([self._resolve_forward_ref(a) if isinstance(a, ForwardRef) else a for a in args])
2026-03-09T14:46:05.117124552Z [err]  For further information visit https://errors.pydantic.dev/2.9/u/undefined-annotation
2026-03-09T14:46:05.117125792Z [err]      schema = self._generate_schema_inner(obj)
2026-03-09T14:46:05.117127898Z [err]                                  ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
2026-03-09T14:46:05.117133700Z [err]                    ^^^^^^^^^^^^^^^^^^^^^^^^^^^^
2026-03-09T14:46:05.117134808Z [err]               ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
2026-03-09T14:46:05.117137377Z [err]    File "/app/.venv/lib/python3.12/site-packages/pydantic/_internal/_generate_schema.py", line 886, in _get_args_resolving_forward_refs
2026-03-09T14:46:05.117141892Z [err]    File "/app/.venv/lib/python3.12/site-packages/pydantic/_internal/_generate_schema.py", line 866, in _resolve_forward_ref
2026-03-09T14:46:05.117142794Z [err]    File "/app/.venv/lib/python3.12/site-packages/pydantic/_internal/_generate_schema.py", line 908, in _generate_schema_inner
2026-03-09T14:46:05.117149546Z [err]      return self._annotated_schema(obj)
2026-03-09T14:46:05.117151121Z [err]      raise PydanticUndefinedAnnotation.from_name_error(e) from e
2026-03-09T14:46:05.117156589Z [err]             ^^^^^^^^^^^^^^^^^^^^^^^^^^^
2026-03-09T14:46:05.117157584Z [err]  pydantic.errors.PydanticUndefinedAnnotation: name 'RegisterAccountRequest' is not defined
2026-03-09T14:46:05.799262315Z [err]  Bytecode compiled 1822 files in 73ms
2026-03-09T14:46:06.810505163Z [err]  
2026-03-09T14:46:06.810518682Z [err]  Traceback (most recent call last):
2026-03-09T14:46:06.810525594Z [err]  Traceback (most recent call last):
2026-03-09T14:46:06.810527680Z [err]    File "/app/.venv/lib/python3.12/site-packages/pydantic/type_adapter.py", line 270, in _init_core_attrs
2026-03-09T14:46:06.810533812Z [err]      self._core_schema = _getattr_no_parents(self._type, '__pydantic_core_schema__')
2026-03-09T14:46:06.810535563Z [err]    File "/app/.venv/lib/python3.12/site-packages/pydantic/_internal/_generate_schema.py", line 864, in _resolve_forward_ref
2026-03-09T14:46:06.810540904Z [err]                          ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
2026-03-09T14:46:06.810542625Z [err]      obj = _typing_extra.eval_type_backport(obj, globalns=self._types_namespace)
2026-03-09T14:46:06.810546940Z [err]    File "/app/.venv/lib/python3.12/site-packages/pydantic/type_adapter.py", line 112, in _getattr_no_parents
2026-03-09T14:46:06.810550402Z [err]            ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
2026-03-09T14:46:06.810553158Z [err]      raise AttributeError(attribute)
2026-03-09T14:46:06.810557940Z [err]    File "/app/.venv/lib/python3.12/site-packages/pydantic/_internal/_typing_extra.py", line 279, in eval_type_backport
2026-03-09T14:46:06.810560443Z [err]  AttributeError: __pydantic_core_schema__
2026-03-09T14:46:06.810564497Z [err]      return _eval_type_backport(value, globalns, localns, type_params)
2026-03-09T14:46:06.810567317Z [err]  
2026-03-09T14:46:06.810571723Z [err]             ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
2026-03-09T14:46:06.810574454Z [err]  During handling of the above exception, another exception occurred:
2026-03-09T14:46:06.810578167Z [err]    File "/app/.venv/lib/python3.12/site-packages/pydantic/_internal/_typing_extra.py", line 303, in _eval_type_backport
2026-03-09T14:46:06.811210159Z [err]      return _eval_type(value, globalns, localns, type_params)
2026-03-09T14:46:06.811221082Z [err]      sys.exit(main())
2026-03-09T14:46:06.811224458Z [err]             ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
2026-03-09T14:46:06.811230840Z [err]    File "/app/.venv/lib/python3.12/site-packages/pydantic/_internal/_typing_extra.py", line 332, in _eval_type
2026-03-09T14:46:06.811233397Z [err]               ^^^^^^
2026-03-09T14:46:06.811237058Z [err]      return typing._eval_type(  # type: ignore
2026-03-09T14:46:06.811242663Z [err]    File "/app/.venv/lib/python3.12/site-packages/click/core.py", line 1485, in __call__
2026-03-09T14:46:06.811243562Z [err]             ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
2026-03-09T14:46:06.811249353Z [err]    File "/usr/local/lib/python3.12/typing.py", line 415, in _eval_type
2026-03-09T14:46:06.811254007Z [err]      return t._evaluate(globalns, localns, type_params, recursive_guard=recursive_guard)
2026-03-09T14:46:06.811258450Z [err]             ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
2026-03-09T14:46:06.811263329Z [err]    File "/usr/local/lib/python3.12/typing.py", line 947, in _evaluate
2026-03-09T14:46:06.811267740Z [err]      eval(self.__forward_code__, globalns, localns),
2026-03-09T14:46:06.811272812Z [err]      ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
2026-03-09T14:46:06.811277122Z [err]    File "<string>", line 1, in <module>
2026-03-09T14:46:06.811281327Z [err]  NameError: name 'RegisterAccountRequest' is not defined
2026-03-09T14:46:06.811285898Z [err]  
2026-03-09T14:46:06.811290127Z [err]  The above exception was the direct cause of the following exception:
2026-03-09T14:46:06.811294607Z [err]  
2026-03-09T14:46:06.811299469Z [err]  Traceback (most recent call last):
2026-03-09T14:46:06.811304742Z [err]    File "/app/.venv/bin/uvicorn", line 10, in <module>
2026-03-09T14:46:06.811896815Z [err]      return self.main(*args, **kwargs)
2026-03-09T14:46:06.811903968Z [err]             ^^^^^^^^^^^^^^^^^^^^^^^^^^
2026-03-09T14:46:06.811908944Z [err]    File "/app/.venv/lib/python3.12/site-packages/click/core.py", line 1406, in main
2026-03-09T14:46:06.811914002Z [err]             ^^^^^^^^^^^^^^^^
2026-03-09T14:46:06.811915033Z [err]      rv = self.invoke(ctx)
2026-03-09T14:46:06.811920362Z [err]           ^^^^^^^^^^^^^^^^
2026-03-09T14:46:06.811923727Z [err]    File "/usr/local/lib/python3.12/asyncio/runners.py", line 118, in run
2026-03-09T14:46:06.811929822Z [err]    File "/app/.venv/lib/python3.12/site-packages/click/core.py", line 1269, in invoke
2026-03-09T14:46:06.811930091Z [err]    File "/app/.venv/lib/python3.12/site-packages/click/core.py", line 824, in invoke
2026-03-09T14:46:06.811936869Z [err]      return ctx.invoke(self.callback, **ctx.params)
2026-03-09T14:46:06.811938206Z [err]      return callback(*args, **kwargs)
2026-03-09T14:46:06.811942896Z [err]             ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
2026-03-09T14:46:06.811945809Z [err]             ^^^^^^^^^^^^^^^^^^^^^^^^^
2026-03-09T14:46:06.811951562Z [err]    File "/app/.venv/lib/python3.12/site-packages/uvicorn/main.py", line 412, in main
2026-03-09T14:46:06.811957227Z [err]      run(
2026-03-09T14:46:06.811962670Z [err]    File "/app/.venv/lib/python3.12/site-packages/uvicorn/main.py", line 579, in run
2026-03-09T14:46:06.811968083Z [err]      server.run()
2026-03-09T14:46:06.811973026Z [err]    File "/app/.venv/lib/python3.12/site-packages/uvicorn/server.py", line 65, in run
2026-03-09T14:46:06.811977856Z [err]      return asyncio.run(self.serve(sockets=sockets))
2026-03-09T14:46:06.811982412Z [err]             ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
2026-03-09T14:46:06.811987824Z [err]    File "/usr/local/lib/python3.12/asyncio/runners.py", line 195, in run
2026-03-09T14:46:06.811992697Z [err]      return runner.run(main)
2026-03-09T14:46:06.812432905Z [err]      return self._loop.run_until_complete(task)
2026-03-09T14:46:06.812435308Z [err]    File "<frozen importlib._bootstrap>", line 1360, in _find_and_load
2026-03-09T14:46:06.812436347Z [err]    File "/app/.venv/lib/python3.12/site-packages/uvicorn/server.py", line 76, in _serve
2026-03-09T14:46:06.812444888Z [err]               ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
2026-03-09T14:46:06.812445211Z [err]             ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
2026-03-09T14:46:06.812446267Z [err]    File "<frozen importlib._bootstrap>", line 1331, in _find_and_load_unlocked
2026-03-09T14:46:06.812446774Z [err]      config.load()
2026-03-09T14:46:06.812454357Z [err]    File "/app/.venv/lib/python3.12/site-packages/uvicorn/config.py", line 434, in load
2026-03-09T14:46:06.812456862Z [err]    File "<frozen importlib._bootstrap>", line 935, in _load_unlocked
2026-03-09T14:46:06.812457133Z [err]    File "/usr/local/lib/python3.12/importlib/__init__.py", line 90, in import_module
2026-03-09T14:46:06.812460742Z [err]    File "uvloop/loop.pyx", line 1518, in uvloop.loop.Loop.run_until_complete
2026-03-09T14:46:06.812465200Z [err]      self.loaded_app = import_from_string(self.app)
2026-03-09T14:46:06.812467283Z [err]      return _bootstrap._gcd_import(name[level:], package, level)
2026-03-09T14:46:06.812468634Z [err]    File "/app/.venv/lib/python3.12/site-packages/uvicorn/server.py", line 69, in serve
2026-03-09T14:46:06.812475407Z [err]                        ^^^^^^^^^^^^^^^^^^^^^^^^^^^^
2026-03-09T14:46:06.812476405Z [err]      await self._serve(sockets)
2026-03-09T14:46:06.812476898Z [err]             ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
2026-03-09T14:46:06.812484557Z [err]    File "<frozen importlib._bootstrap>", line 1387, in _gcd_import
2026-03-09T14:46:06.812486410Z [err]    File "/app/.venv/lib/python3.12/site-packages/uvicorn/importer.py", line 19, in import_from_string
2026-03-09T14:46:06.812493847Z [err]      module = importlib.import_module(module_str)
2026-03-09T14:46:06.813028351Z [err]    File "<frozen importlib._bootstrap_external>", line 999, in exec_module
2026-03-09T14:46:06.813034057Z [err]    File "<frozen importlib._bootstrap>", line 488, in _call_with_frames_removed
2026-03-09T14:46:06.813040030Z [err]    File "/app/main.py", line 16, in <module>
2026-03-09T14:46:06.813040858Z [err]    File "/app/.venv/lib/python3.12/site-packages/fastapi/dependencies/utils.py", line 478, in analyze_param
2026-03-09T14:46:06.813045354Z [err]      from app.api.routes import accounts, health, optimizer, portfolio, rebalance
2026-03-09T14:46:06.813051081Z [err]    File "/app/app/api/routes/accounts.py", line 96, in <module>
2026-03-09T14:46:06.813056049Z [err]      @router.post("", response_model=AccountResponse, status_code=status.HTTP_201_CREATED)
2026-03-09T14:46:06.813061357Z [err]       ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
2026-03-09T14:46:06.813065696Z [err]    File "/app/.venv/lib/python3.12/site-packages/fastapi/routing.py", line 992, in decorator
2026-03-09T14:46:06.813069925Z [err]      self.add_api_route(
2026-03-09T14:46:06.813074570Z [err]    File "/app/.venv/lib/python3.12/site-packages/fastapi/routing.py", line 931, in add_api_route
2026-03-09T14:46:06.813079055Z [err]      route = route_class(
2026-03-09T14:46:06.813083728Z [err]              ^^^^^^^^^^^^
2026-03-09T14:46:06.813088428Z [err]    File "/app/.venv/lib/python3.12/site-packages/fastapi/routing.py", line 552, in __init__
2026-03-09T14:46:06.813092783Z [err]      self.dependant = get_dependant(path=self.path_format, call=self.endpoint)
2026-03-09T14:46:06.813096863Z [err]                       ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
2026-03-09T14:46:06.813101792Z [err]    File "/app/.venv/lib/python3.12/site-packages/fastapi/dependencies/utils.py", line 277, in get_dependant
2026-03-09T14:46:06.813106484Z [err]      param_details = analyze_param(
2026-03-09T14:46:06.813111169Z [err]                      ^^^^^^^^^^^^^^
2026-03-09T14:46:06.813705108Z [err]    File "/app/.venv/lib/python3.12/site-packages/pydantic/type_adapter.py", line 95, in _get_schema
2026-03-09T14:46:06.813708580Z [err]      field = create_model_field(
2026-03-09T14:46:06.813713361Z [err]    File "/app/.venv/lib/python3.12/site-packages/pydantic/type_adapter.py", line 277, in _init_core_attrs
2026-03-09T14:46:06.813715237Z [err]      schema = gen.generate_schema(type_)
2026-03-09T14:46:06.813718092Z [err]              ^^^^^^^^^^^^^^^^^^^
2026-03-09T14:46:06.813723825Z [err]      self._core_schema = _get_schema(self._type, config_wrapper, parent_depth=self._parent_depth)
2026-03-09T14:46:06.813727300Z [err]    File "/app/.venv/lib/python3.12/site-packages/fastapi/utils.py", line 96, in create_model_field
2026-03-09T14:46:06.813729059Z [err]                                             ^^^^^^^^^^^^
2026-03-09T14:46:06.813731023Z [err]                          ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
2026-03-09T14:46:06.813733928Z [err]      return ModelField(**kwargs)  # type: ignore[arg-type]
2026-03-09T14:46:06.813738718Z [err]    File "/app/.venv/lib/python3.12/site-packages/pydantic/type_adapter.py", line 257, in __init__
2026-03-09T14:46:06.813740527Z [err]             ^^^^^^^^^^^^^^^^^^^^
2026-03-09T14:46:06.813747859Z [err]      self._init_core_attrs(rebuild_mocks=False)
2026-03-09T14:46:06.813748061Z [err]    File "<string>", line 6, in __init__
2026-03-09T14:46:06.813755037Z [err]    File "/app/.venv/lib/python3.12/site-packages/pydantic/type_adapter.py", line 135, in wrapped
2026-03-09T14:46:06.813756076Z [err]    File "/app/.venv/lib/python3.12/site-packages/fastapi/_compat.py", line 110, in __post_init__
2026-03-09T14:46:06.813765579Z [err]      self._type_adapter: TypeAdapter[Any] = TypeAdapter(
2026-03-09T14:46:06.813766118Z [err]      return func(self, *args, **kwargs)
2026-03-09T14:46:06.813772473Z [err]             ^^^^^^^^^^^^^^^^^^^^^^^^^^^
2026-03-09T14:46:06.814198453Z [err]               ^^^^^^^^^^^^^^^^^^^^^^^^^^
2026-03-09T14:46:06.814203134Z [err]    File "/app/.venv/lib/python3.12/site-packages/pydantic/_internal/_generate_schema.py", line 886, in _get_args_resolving_forward_refs
2026-03-09T14:46:06.814205749Z [err]    File "/app/.venv/lib/python3.12/site-packages/pydantic/_internal/_generate_schema.py", line 655, in generate_schema
2026-03-09T14:46:06.814212329Z [err]      schema = self._generate_schema_inner(obj)
2026-03-09T14:46:06.814215022Z [err]      args = tuple([self._resolve_forward_ref(a) if isinstance(a, ForwardRef) else a for a in args])
2026-03-09T14:46:06.814217581Z [err]               ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
2026-03-09T14:46:06.814223853Z [err]                    ^^^^^^^^^^^^^^^^^^^^^^^^^^^^
2026-03-09T14:46:06.814223906Z [err]    File "/app/.venv/lib/python3.12/site-packages/pydantic/_internal/_generate_schema.py", line 908, in _generate_schema_inner
2026-03-09T14:46:06.814230823Z [err]      return self._annotated_schema(obj)
2026-03-09T14:46:06.814230910Z [err]    File "/app/.venv/lib/python3.12/site-packages/pydantic/_internal/_generate_schema.py", line 866, in _resolve_forward_ref
2026-03-09T14:46:06.814237485Z [err]      raise PydanticUndefinedAnnotation.from_name_error(e) from e
2026-03-09T14:46:06.814237603Z [err]             ^^^^^^^^^^^^^^^^^^^^^^^^^^^
2026-03-09T14:46:06.814244760Z [err]  pydantic.errors.PydanticUndefinedAnnotation: name 'RegisterAccountRequest' is not defined
2026-03-09T14:46:06.814244823Z [err]    File "/app/.venv/lib/python3.12/site-packages/pydantic/_internal/_generate_schema.py", line 2024, in _annotated_schema
2026-03-09T14:46:06.814253460Z [err]  
2026-03-09T14:46:06.814254498Z [err]      source_type, *annotations = self._get_args_resolving_forward_refs(
2026-03-09T14:46:06.814261540Z [err]  For further information visit https://errors.pydantic.dev/2.9/u/undefined-annotation
2026-03-09T14:46:06.814261742Z [err]                                  ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
2026-03-09T14:46:07.522384888Z [err]  Bytecode compiled 1822 files in 87ms
2026-03-09T14:46:08.570857603Z [err]  Traceback (most recent call last):
2026-03-09T14:46:08.570866106Z [err]    File "/app/.venv/lib/python3.12/site-packages/pydantic/type_adapter.py", line 270, in _init_core_attrs
2026-03-09T14:46:08.570872923Z [err]      self._core_schema = _getattr_no_parents(self._type, '__pydantic_core_schema__')
2026-03-09T14:46:08.570878410Z [err]                          ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
2026-03-09T14:46:08.570883237Z [err]    File "/app/.venv/lib/python3.12/site-packages/pydantic/type_adapter.py", line 112, in _getattr_no_parents
2026-03-09T14:46:08.571959832Z [err]    File "/app/.venv/lib/python3.12/site-packages/pydantic/_internal/_typing_extra.py", line 303, in _eval_type_backport
2026-03-09T14:46:08.571970168Z [err]      return _eval_type(value, globalns, localns, type_params)
2026-03-09T14:46:08.571977233Z [err]             ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
2026-03-09T14:46:08.571984467Z [err]    File "/app/.venv/lib/python3.12/site-packages/pydantic/_internal/_typing_extra.py", line 332, in _eval_type
2026-03-09T14:46:08.571987865Z [err]      raise AttributeError(attribute)
2026-03-09T14:46:08.571992253Z [err]      return typing._eval_type(  # type: ignore
2026-03-09T14:46:08.571998655Z [err]  AttributeError: __pydantic_core_schema__
2026-03-09T14:46:08.572000955Z [err]             ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
2026-03-09T14:46:08.572005872Z [err]  
2026-03-09T14:46:08.572009779Z [err]    File "/usr/local/lib/python3.12/typing.py", line 415, in _eval_type
2026-03-09T14:46:08.572012883Z [err]  During handling of the above exception, another exception occurred:
2026-03-09T14:46:08.572018059Z [err]  
2026-03-09T14:46:08.572023328Z [err]  Traceback (most recent call last):
2026-03-09T14:46:08.572028350Z [err]    File "/app/.venv/lib/python3.12/site-packages/pydantic/_internal/_generate_schema.py", line 864, in _resolve_forward_ref
2026-03-09T14:46:08.572033188Z [err]      obj = _typing_extra.eval_type_backport(obj, globalns=self._types_namespace)
2026-03-09T14:46:08.572037871Z [err]            ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
2026-03-09T14:46:08.572042665Z [err]    File "/app/.venv/lib/python3.12/site-packages/pydantic/_internal/_typing_extra.py", line 279, in eval_type_backport
2026-03-09T14:46:08.572050664Z [err]      return _eval_type_backport(value, globalns, localns, type_params)
2026-03-09T14:46:08.572056331Z [err]             ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
2026-03-09T14:46:08.573059803Z [err]           ^^^^^^^^^^^^^^^^
2026-03-09T14:46:08.573066713Z [err]    File "/app/.venv/lib/python3.12/site-packages/click/core.py", line 1485, in __call__
2026-03-09T14:46:08.573069337Z [err]    File "/app/.venv/lib/python3.12/site-packages/click/core.py", line 1269, in invoke
2026-03-09T14:46:08.573078033Z [err]      return self.main(*args, **kwargs)
2026-03-09T14:46:08.573079882Z [err]      return ctx.invoke(self.callback, **ctx.params)
2026-03-09T14:46:08.573081165Z [err]      return t._evaluate(globalns, localns, type_params, recursive_guard=recursive_guard)
2026-03-09T14:46:08.573085692Z [err]             ^^^^^^^^^^^^^^^^^^^^^^^^^^
2026-03-09T14:46:08.573089803Z [err]             ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
2026-03-09T14:46:08.573092774Z [err]             ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
2026-03-09T14:46:08.573092880Z [err]    File "/app/.venv/lib/python3.12/site-packages/click/core.py", line 1406, in main
2026-03-09T14:46:08.573095986Z [err]  Traceback (most recent call last):
2026-03-09T14:46:08.573100095Z [err]    File "/usr/local/lib/python3.12/typing.py", line 947, in _evaluate
2026-03-09T14:46:08.573103176Z [err]      rv = self.invoke(ctx)
2026-03-09T14:46:08.573107370Z [err]    File "/app/.venv/bin/uvicorn", line 10, in <module>
2026-03-09T14:46:08.573110864Z [err]      eval(self.__forward_code__, globalns, localns),
2026-03-09T14:46:08.573116264Z [err]      sys.exit(main())
2026-03-09T14:46:08.573118254Z [err]      ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
2026-03-09T14:46:08.573123930Z [err]               ^^^^^^
2026-03-09T14:46:08.573125143Z [err]    File "<string>", line 1, in <module>
2026-03-09T14:46:08.573129845Z [err]  NameError: name 'RegisterAccountRequest' is not defined
2026-03-09T14:46:08.573135390Z [err]  
2026-03-09T14:46:08.573141531Z [err]  The above exception was the direct cause of the following exception:
2026-03-09T14:46:08.573147292Z [err]  
2026-03-09T14:46:08.573616184Z [err]    File "/app/.venv/lib/python3.12/site-packages/click/core.py", line 824, in invoke
2026-03-09T14:46:08.573623264Z [err]      return callback(*args, **kwargs)
2026-03-09T14:46:08.573626481Z [err]      config.load()
2026-03-09T14:46:08.573630933Z [err]             ^^^^^^^^^^^^^^^^^^^^^^^^^
2026-03-09T14:46:08.573633831Z [err]    File "uvloop/loop.pyx", line 1518, in uvloop.loop.Loop.run_until_complete
2026-03-09T14:46:08.573634785Z [err]    File "/usr/local/lib/python3.12/asyncio/runners.py", line 195, in run
2026-03-09T14:46:08.573639320Z [err]    File "/app/.venv/lib/python3.12/site-packages/uvicorn/main.py", line 412, in main
2026-03-09T14:46:08.573642414Z [err]    File "/app/.venv/lib/python3.12/site-packages/uvicorn/server.py", line 69, in serve
2026-03-09T14:46:08.573647679Z [err]      return runner.run(main)
2026-03-09T14:46:08.573648277Z [err]      run(
2026-03-09T14:46:08.573650714Z [err]      await self._serve(sockets)
2026-03-09T14:46:08.573657500Z [err]             ^^^^^^^^^^^^^^^^
2026-03-09T14:46:08.573659796Z [err]    File "/app/.venv/lib/python3.12/site-packages/uvicorn/server.py", line 76, in _serve
2026-03-09T14:46:08.573663006Z [err]    File "/app/.venv/lib/python3.12/site-packages/uvicorn/main.py", line 579, in run
2026-03-09T14:46:08.573665473Z [err]    File "/usr/local/lib/python3.12/asyncio/runners.py", line 118, in run
2026-03-09T14:46:08.573672326Z [err]      server.run()
2026-03-09T14:46:08.573673417Z [err]      return self._loop.run_until_complete(task)
2026-03-09T14:46:08.573681167Z [err]    File "/app/.venv/lib/python3.12/site-packages/uvicorn/server.py", line 65, in run
2026-03-09T14:46:08.573682043Z [err]             ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
2026-03-09T14:46:08.573686853Z [err]      return asyncio.run(self.serve(sockets=sockets))
2026-03-09T14:46:08.573691878Z [err]             ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
2026-03-09T14:46:08.574398728Z [err]      from app.api.routes import accounts, health, optimizer, portfolio, rebalance
2026-03-09T14:46:08.574402111Z [err]    File "/app/.venv/lib/python3.12/site-packages/uvicorn/config.py", line 434, in load
2026-03-09T14:46:08.574405987Z [err]    File "/app/app/api/routes/accounts.py", line 96, in <module>
2026-03-09T14:46:08.574412730Z [err]      @router.post("", response_model=AccountResponse, status_code=status.HTTP_201_CREATED)
2026-03-09T14:46:08.574413298Z [err]      self.loaded_app = import_from_string(self.app)
2026-03-09T14:46:08.574421501Z [err]                        ^^^^^^^^^^^^^^^^^^^^^^^^^^^^
2026-03-09T14:46:08.574430877Z [err]    File "/app/.venv/lib/python3.12/site-packages/uvicorn/importer.py", line 19, in import_from_string
2026-03-09T14:46:08.574437813Z [err]      module = importlib.import_module(module_str)
2026-03-09T14:46:08.574443899Z [err]               ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
2026-03-09T14:46:08.574449933Z [err]    File "/usr/local/lib/python3.12/importlib/__init__.py", line 90, in import_module
2026-03-09T14:46:08.574456582Z [err]      return _bootstrap._gcd_import(name[level:], package, level)
2026-03-09T14:46:08.574463113Z [err]             ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
2026-03-09T14:46:08.574468590Z [err]    File "<frozen importlib._bootstrap>", line 1387, in _gcd_import
2026-03-09T14:46:08.574475687Z [err]    File "<frozen importlib._bootstrap>", line 1360, in _find_and_load
2026-03-09T14:46:08.574479959Z [err]    File "<frozen importlib._bootstrap>", line 1331, in _find_and_load_unlocked
2026-03-09T14:46:08.574485456Z [err]    File "<frozen importlib._bootstrap>", line 935, in _load_unlocked
2026-03-09T14:46:08.574489598Z [err]    File "<frozen importlib._bootstrap_external>", line 999, in exec_module
2026-03-09T14:46:08.574494140Z [err]    File "<frozen importlib._bootstrap>", line 488, in _call_with_frames_removed
2026-03-09T14:46:08.574498192Z [err]    File "/app/main.py", line 16, in <module>
2026-03-09T14:46:08.575096685Z [err]       ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
2026-03-09T14:46:08.575103345Z [err]    File "/app/.venv/lib/python3.12/site-packages/fastapi/routing.py", line 992, in decorator
2026-03-09T14:46:08.575106420Z [err]             ^^^^^^^^^^^^^^^^^^^^
2026-03-09T14:46:08.575110349Z [err]      self.add_api_route(
2026-03-09T14:46:08.575116415Z [err]    File "<string>", line 6, in __init__
2026-03-09T14:46:08.575116810Z [err]    File "/app/.venv/lib/python3.12/site-packages/fastapi/utils.py", line 96, in create_model_field
2026-03-09T14:46:08.575118170Z [err]      param_details = analyze_param(
2026-03-09T14:46:08.575119548Z [err]    File "/app/.venv/lib/python3.12/site-packages/fastapi/routing.py", line 931, in add_api_route
2026-03-09T14:46:08.575128317Z [err]      route = route_class(
2026-03-09T14:46:08.575129003Z [err]                      ^^^^^^^^^^^^^^
2026-03-09T14:46:08.575129225Z [err]      return ModelField(**kwargs)  # type: ignore[arg-type]
2026-03-09T14:46:08.575130984Z [err]    File "/app/.venv/lib/python3.12/site-packages/fastapi/_compat.py", line 110, in __post_init__
2026-03-09T14:46:08.575136340Z [err]    File "/app/.venv/lib/python3.12/site-packages/fastapi/routing.py", line 552, in __init__
2026-03-09T14:46:08.575138600Z [err]              ^^^^^^^^^^^^
2026-03-09T14:46:08.575139760Z [err]    File "/app/.venv/lib/python3.12/site-packages/fastapi/dependencies/utils.py", line 478, in analyze_param
2026-03-09T14:46:08.575145758Z [err]      self.dependant = get_dependant(path=self.path_format, call=self.endpoint)
2026-03-09T14:46:08.575148735Z [err]      field = create_model_field(
2026-03-09T14:46:08.575152095Z [err]                       ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
2026-03-09T14:46:08.575156593Z [err]              ^^^^^^^^^^^^^^^^^^^
2026-03-09T14:46:08.575167647Z [err]    File "/app/.venv/lib/python3.12/site-packages/fastapi/dependencies/utils.py", line 277, in get_dependant
2026-03-09T14:46:08.576182749Z [err]      self._type_adapter: TypeAdapter[Any] = TypeAdapter(
2026-03-09T14:46:08.576189681Z [err]      return self._annotated_schema(obj)
2026-03-09T14:46:08.576191028Z [err]                                             ^^^^^^^^^^^^
2026-03-09T14:46:08.576191650Z [err]    File "/app/.venv/lib/python3.12/site-packages/pydantic/type_adapter.py", line 95, in _get_schema
2026-03-09T14:46:08.576197634Z [err]    File "/app/.venv/lib/python3.12/site-packages/pydantic/type_adapter.py", line 257, in __init__
2026-03-09T14:46:08.576200308Z [err]      schema = gen.generate_schema(type_)
2026-03-09T14:46:08.576204271Z [err]      self._init_core_attrs(rebuild_mocks=False)
2026-03-09T14:46:08.576208656Z [err]               ^^^^^^^^^^^^^^^^^^^^^^^^^^
2026-03-09T14:46:08.576211132Z [err]    File "/app/.venv/lib/python3.12/site-packages/pydantic/type_adapter.py", line 135, in wrapped
2026-03-09T14:46:08.576216498Z [err]    File "/app/.venv/lib/python3.12/site-packages/pydantic/_internal/_generate_schema.py", line 655, in generate_schema
2026-03-09T14:46:08.576219005Z [err]      return func(self, *args, **kwargs)
2026-03-09T14:46:08.576225466Z [err]      schema = self._generate_schema_inner(obj)
2026-03-09T14:46:08.576232132Z [err]             ^^^^^^^^^^^^^^^^^^^^^^^^^^^
2026-03-09T14:46:08.576236220Z [err]               ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
2026-03-09T14:46:08.576238930Z [err]    File "/app/.venv/lib/python3.12/site-packages/pydantic/type_adapter.py", line 277, in _init_core_attrs
2026-03-09T14:46:08.576241836Z [err]    File "/app/.venv/lib/python3.12/site-packages/pydantic/_internal/_generate_schema.py", line 908, in _generate_schema_inner
2026-03-09T14:46:08.576246795Z [err]      self._core_schema = _get_schema(self._type, config_wrapper, parent_depth=self._parent_depth)
2026-03-09T14:46:08.576252319Z [err]                          ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
2026-03-09T14:46:08.576791353Z [err]             ^^^^^^^^^^^^^^^^^^^^^^^^^^^
2026-03-09T14:46:08.576797272Z [err]    File "/app/.venv/lib/python3.12/site-packages/pydantic/_internal/_generate_schema.py", line 2024, in _annotated_schema
2026-03-09T14:46:08.576802205Z [err]      source_type, *annotations = self._get_args_resolving_forward_refs(
2026-03-09T14:46:08.576806970Z [err]                                  ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
2026-03-09T14:46:08.576812268Z [err]    File "/app/.venv/lib/python3.12/site-packages/pydantic/_internal/_generate_schema.py", line 886, in _get_args_resolving_forward_refs
2026-03-09T14:46:08.576817652Z [err]      args = tuple([self._resolve_forward_ref(a) if isinstance(a, ForwardRef) else a for a in args])
2026-03-09T14:46:08.576822637Z [err]                    ^^^^^^^^^^^^^^^^^^^^^^^^^^^^
2026-03-09T14:46:08.576827673Z [err]    File "/app/.venv/lib/python3.12/site-packages/pydantic/_internal/_generate_schema.py", line 866, in _resolve_forward_ref
2026-03-09T14:46:08.576832355Z [err]      raise PydanticUndefinedAnnotation.from_name_error(e) from e
2026-03-09T14:46:08.576837473Z [err]  pydantic.errors.PydanticUndefinedAnnotation: name 'RegisterAccountRequest' is not defined
2026-03-09T14:46:08.576842754Z [err]  
2026-03-09T14:46:08.576847443Z [err]  For further information visit https://errors.pydantic.dev/2.9/u/undefined-annotation