cmake_minimum_required(VERSION 3.24)
project(GsePhysics LANGUAGES CXX)

include(FetchContent)
find_package(Git REQUIRED)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)
set(BUILD_SHARED_LIBS OFF CACHE BOOL "" FORCE)
set(CPP_EXCEPTIONS_ENABLED ON CACHE BOOL "" FORCE)
set(INTERPROCEDURAL_OPTIMIZATION OFF CACHE BOOL "" FORCE)
set(ENABLE_OBJECT_STREAM OFF CACHE BOOL "" FORCE)
set(DEBUG_RENDERER_IN_DEBUG_AND_RELEASE OFF CACHE BOOL "" FORCE)
set(DEBUG_RENDERER_IN_DISTRIBUTION OFF CACHE BOOL "" FORCE)
set(PROFILER_IN_DEBUG_AND_RELEASE OFF CACHE BOOL "" FORCE)
set(PROFILER_IN_DISTRIBUTION OFF CACHE BOOL "" FORCE)
set(USE_WASM_SIMD OFF CACHE BOOL "" FORCE)
set(USE_SSE4_1 OFF CACHE BOOL "" FORCE)
set(USE_SSE4_2 OFF CACHE BOOL "" FORCE)
set(USE_AVX OFF CACHE BOOL "" FORCE)
set(USE_AVX2 OFF CACHE BOOL "" FORCE)
set(USE_AVX512 OFF CACHE BOOL "" FORCE)
set(USE_LZCNT OFF CACHE BOOL "" FORCE)
set(USE_TZCNT OFF CACHE BOOL "" FORCE)
set(USE_F16C OFF CACHE BOOL "" FORCE)
set(USE_FMADD OFF CACHE BOOL "" FORCE)
set(TARGET_HELLO_WORLD OFF CACHE BOOL "" FORCE)
set(TARGET_PERFORMANCE_TEST OFF CACHE BOOL "" FORCE)
set(TARGET_SAMPLES OFF CACHE BOOL "" FORCE)
set(TARGET_UNIT_TESTS OFF CACHE BOOL "" FORCE)
set(TARGET_VIEWER OFF CACHE BOOL "" FORCE)

FetchContent_Declare(
  JoltPhysics
  GIT_REPOSITORY https://github.com/jrouwe/JoltPhysics.git
  GIT_TAG v5.3.0
  GIT_SHALLOW TRUE
  SOURCE_SUBDIR Build
)
FetchContent_MakeAvailable(JoltPhysics)
execute_process(
  COMMAND "${GIT_EXECUTABLE}" -C "${joltphysics_SOURCE_DIR}" rev-parse HEAD
  OUTPUT_VARIABLE JOLT_PHYSICS_COMMIT
  OUTPUT_STRIP_TRAILING_WHITESPACE
  RESULT_VARIABLE JOLT_PHYSICS_GIT_RESULT
)
if(NOT JOLT_PHYSICS_GIT_RESULT EQUAL 0 OR
   NOT JOLT_PHYSICS_COMMIT STREQUAL "0373ec0dd762e4bc2f6acdb08371ee84fa23c6db")
  message(FATAL_ERROR "Jolt Physics v5.3.0 must resolve to the pinned source commit.")
endif()

add_library(gse_physics STATIC gse_physics.cpp)
target_link_libraries(gse_physics PUBLIC Jolt)
target_compile_features(gse_physics PUBLIC cxx_std_17)

if(EMSCRIPTEN)
  add_executable(gse_physics_wasm gse_physics_bindings.cpp)
  target_link_libraries(gse_physics_wasm PRIVATE gse_physics)
  target_compile_options(gse_physics PRIVATE -fexceptions)
  target_compile_options(gse_physics_wasm PRIVATE -fexceptions)
  target_link_options(gse_physics_wasm PRIVATE
    --bind
    -fexceptions
    -sDISABLE_EXCEPTION_CATCHING=0
    -sMODULARIZE=1
    -sEXPORT_ES6=1
    -sEXPORT_NAME=createGsePhysicsModule
    -sEXPORTED_RUNTIME_METHODS=getExceptionMessage,decrementExceptionRefcount,stackSave,stackRestore
    -sENVIRONMENT=web,node
    -sALLOW_MEMORY_GROWTH=1
    -sINITIAL_MEMORY=67108864
    -sNO_EXIT_RUNTIME=1
  )
  set_target_properties(gse_physics_wasm PROPERTIES
    OUTPUT_NAME gse_physics
    SUFFIX ".js"
    RUNTIME_OUTPUT_DIRECTORY "${CMAKE_CURRENT_SOURCE_DIR}/../../public/physics"
  )
else()
  enable_testing()
  add_executable(gse_physics_native_smoke native_smoke.cpp)
  target_link_libraries(gse_physics_native_smoke PRIVATE gse_physics)
  add_test(NAME gse_physics_native_smoke COMMAND gse_physics_native_smoke)
endif()
