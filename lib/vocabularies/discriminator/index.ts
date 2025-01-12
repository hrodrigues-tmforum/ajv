import type {CodeKeywordDefinition, AnySchemaObject, KeywordErrorDefinition} from "../../types"
import type {KeywordCxt} from "../../compile/validate"
import {_, getProperty, Name} from "../../compile/codegen"
import {DiscrError, DiscrErrorObj} from "../discriminator/types"
import {resolveRef, SchemaEnv} from "../../compile"
import {schemaHasRulesButRef} from "../../compile/util"

export type DiscriminatorError = DiscrErrorObj<DiscrError.Tag> | DiscrErrorObj<DiscrError.Mapping>

const error: KeywordErrorDefinition = {
  message: ({params: {discrError, tagName}}) =>
    discrError === DiscrError.Tag
      ? `property "${tagName}" must be string`
      : `value of property "${tagName}" must be in oneOf`,
  params: ({params: {discrError, tag, tagName}}) =>
    _`{error: ${discrError}, property: ${tagName}, propertyValue: ${tag}}`,
}

const def: CodeKeywordDefinition = {
  keyword: "discriminator",
  type: "object",
  schemaType: "object",
  error,
  code: function (cxt: KeywordCxt) {
    const {gen, data, schema, parentSchema, it} = cxt
    const {oneOf} = parentSchema
    if (!it.opts.discriminator) {
      throw new Error("discriminator: requires discriminator option")
    }
    const tagName = schema.propertyName
    if (typeof tagName != "string") throw new Error("discriminator: requires propertyName")
    if (schema.mapping && strictDiscriminatorValidation(it)) {
      throw new Error("discriminator: mapping is not supported")
    }
    if (!oneOf) throw new Error("discriminator: requires oneOf keyword")
    const valid = gen.let("valid", false)
    const tag = gen.const("tag", _`${data}${getProperty(tagName)}`)
    gen.if(
      _`typeof ${tag} == "string"`,
      () => validateMapping(),
      () => cxt.error(false, {discrError: DiscrError.Tag, tag, tagName})
    )
    cxt.ok(valid)

    function validateMapping(): void {
      const mapping = getMapping()
      gen.if(false)
      for (const tagValue in mapping) {
        gen.elseIf(_`${tag} === ${tagValue}`)
        gen.assign(valid, applyTagSchema(mapping[tagValue]))
      }
      gen.else()
      cxt.error(false, {discrError: DiscrError.Mapping, tag, tagName})
      gen.endIf()
    }

    function applyTagSchema(schemaProp?: number): Name {
      const _valid = gen.name("valid")
      const schCxt = cxt.subschema({keyword: "oneOf", schemaProp}, _valid)
      cxt.mergeEvaluated(schCxt, Name)
      return _valid
    }

    function getMapping(): {[T in string]?: number} {
      const oneOfMapping: {[T in string]?: number} = {}
      const topRequired = hasRequired(parentSchema)
      let tagRequired = true
      for (let i = 0; i < oneOf.length; i++) {
        let sch = oneOf[i]
        if (sch?.$ref && !schemaHasRulesButRef(sch, it.self.RULES)) {
          sch = resolveRef.call(it.self, it.schemaEnv.root, it.baseId, sch?.$ref)
          if (sch instanceof SchemaEnv) sch = sch.schema
        }
        let propSch = sch?.properties?.[tagName]
        let hasSubSchRequired = false
        if (!propSch && sch?.allOf) {
          const {hasRequired, propertyObject} = mapDiscriminatorFromAllOf(propSch, sch)
          hasSubSchRequired = hasRequired
          propSch = propertyObject
        }
        if (!propSch || typeof propSch != "object") {
          throw new Error(
            `discriminator: oneOf subschemas (or referenced schemas) must have "properties/${tagName}"`
          )
        }
        tagRequired = tagRequired && (topRequired || hasRequired(sch) || hasSubSchRequired)
        addMappings(propSch, i)
      }
      if (!tagRequired) throw new Error(`discriminator: "${tagName}" must be required`)
      return oneOfMapping

      function mapDiscriminatorFromAllOf(
        propSch: any,
        sch: any
      ): {hasRequired: boolean; propertyObject: any} {
        let subSchObj: any = null
        for (const subSch of sch.allOf) {
          if (subSch?.properties) {
            propSch = subSch.properties[tagName]
            subSchObj = subSch
          } else if (subSch?.$ref) {
            subSchObj = resolveRef.call(it.self, it.schemaEnv.root, it.baseId, subSch.$ref)
            if (subSchObj instanceof SchemaEnv) subSchObj = subSchObj.schema
            propSch = subSchObj?.properties?.[tagName]
          }
          if (propSch) {
            //found discriminator mapping in one of the allOf objects, stop searching
            return {hasRequired: hasRequired(subSchObj), propertyObject: propSch}
          }
        }
        return {hasRequired: false, propertyObject: null}
      }

      function hasRequired({required}: AnySchemaObject): boolean {
        return Array.isArray(required) && required.includes(tagName)
      }

      function addMappings(sch: AnySchemaObject, i: number): void {
        if (sch.const) {
          addMapping(sch.const, i)
        } else if (sch.enum) {
          for (const tagValue of sch.enum) {
            addMapping(tagValue, i)
          }
        } else {
          throw new Error(`discriminator: "properties/${tagName}" must have "const" or "enum"`)
        }
      }

      function addMapping(tagValue: unknown, i: number): void {
        if (typeof tagValue != "string" || tagValue in oneOfMapping) {
          throw new Error(`discriminator: "${tagName}" values must be unique strings`)
        }
        oneOfMapping[tagValue] = i
      }
    }
  },
}

export function strictDiscriminatorValidation(it: SchemaObjCxt): boolean {
  if (it.opts.discriminator instanceof Object) return it.opts.discriminator.strict
  return true
}

export default def
